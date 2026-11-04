import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationCredentials } from '../../integrations/infisical';
import { IntegrationSettings } from '../../integrations/settings';
import { createApp } from '../../app';
import { loadEnv } from '../../env';
import { newLoginToken, newSession } from '../../auth/tokens';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

const credentials: IntegrationCredentials = {
  stripe: { secretKey: 'sk_test_access_fixture', webhookSecret: 'whsec_access_fixture' },
  gmail: { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' },
};

const env = loadEnv({
  DATABASE_URL: 'postgresql://test:test@localhost:5432/netballtrials_test',
  NODE_ENV: 'production', APP_ENV: 'testing', PAYMENT_PROVIDER: 'stripe', SESSION_COOKIE_SECURE: 'true',
  WEB_ORIGIN: 'https://test.example', API_PUBLIC_URL: 'https://api.test.example', ENABLE_TEST_INTEGRATIONS: 'true',
  MAIL_FROM: 'cmoyle@gmail.com', MAIL_REPLY_TO: 'cmoyle@gmail.com',
  INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'test-client-id', INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'test-client-secret',
  INFISICAL_PROJECT_ID: 'test-project', INFISICAL_ENVIRONMENT: 'test', INFISICAL_SECRET_PATH: '/',
});

let app: ReturnType<typeof createApp>;
const gmailRequests: string[] = [];

beforeEach(async () => {
  await resetDb();
  gmailRequests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    gmailRequests.push(url);
    return new Response(url.includes('/token')
      ? JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 })
      : JSON.stringify({ id: 'test-message' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
  const integrationSettings = new IntegrationSettings(env);
  vi.spyOn(integrationSettings, 'readCredentials').mockResolvedValue(credentials);
  app = createApp({ prisma, env, integrationSettings }, { logStream: { write: () => undefined } });
  await app.ready();
});

afterEach(async () => {
  try { await app.close(); }
  finally { vi.unstubAllGlobals(); }
});

async function sessionCookie(email: string): Promise<string> {
  const user = await prisma.staffUser.create({ data: { email } });
  const session = newSession(new Date());
  await prisma.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
  return `nt_session=${session.token}`;
}

describe('hosted test integration access gate', () => {
  it('keeps health and sign-in public, gates application data, and exposes only signed webhooks', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ appEnv: 'testing', testAccessRequired: true, testIntegrationsEnabled: true });

    const signIn = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'unknown@example.test' } });
    expect(signIn.statusCode).toBe(202);
    const invitedAdmin = await prisma.staffUser.create({ data: { email: 'invited-admin@example.test' } });
    const inviteToken = newLoginToken(new Date());
    await prisma.loginToken.create({ data: { userId: invitedAdmin.id, tokenHash: inviteToken.tokenHash, expiresAt: inviteToken.expiresAt } });
    const invitedAdminVerify = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: inviteToken.token } });
    expect(invitedAdminVerify.statusCode).toBe(200);
    expect(await prisma.session.count()).toBe(1);

    const publicData = await app.inject({ method: 'GET', url: '/api/public/events' });
    expect(publicData.statusCode).toBe(401);

    const webhook = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: {} });
    expect(webhook.statusCode).toBe(400);
    expect(webhook.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('lets an Admin manage the database roster and simulates messages to non-Admin addresses', async () => {
    const allowedCookie = await sessionCookie('cmoyle@gmail.com');
    const publicData = await app.inject({ method: 'GET', url: '/api/public/events', headers: { cookie: allowedCookie } });
    expect(publicData.statusCode).toBe(200);

    const outbox = await app.inject({ method: 'GET', url: '/api/admin/test-email-outbox', headers: { cookie: allowedCookie } });
    expect(outbox.statusCode).toBe(200);
    expect(outbox.json()).toEqual([]);

    const adminInvite = await app.inject({
      method: 'POST', url: '/api/admin/staff/invites', headers: { cookie: allowedCookie },
      payload: { email: 'nicole@example.test' },
    });
    expect(adminInvite.statusCode).toBe(202);
    expect(gmailRequests.filter((url) => url.includes('/messages/send'))).toHaveLength(1);
    const newAdminInvite = await app.inject({
      method: 'POST', url: '/api/admin/staff/invites', headers: { cookie: allowedCookie },
      payload: { email: 'new-admin@example.test' },
    });
    expect(newAdminInvite.statusCode).toBe(202);
    expect(await prisma.staffUser.findUnique({ where: { email: 'new-admin@example.test' } })).not.toBeNull();
    const selfRequestedLink = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'new-admin@example.test' } });
    expect(selfRequestedLink.statusCode).toBe(202);
    for (const email of ['fourth@example.test', 'fifth@example.test']) {
      const invite = await app.inject({
        method: 'POST', url: '/api/admin/staff/invites', headers: { cookie: allowedCookie }, payload: { email },
      });
      expect(invite.statusCode).toBe(202);
    }
    const overLimitInvite = await app.inject({
      method: 'POST', url: '/api/admin/staff/invites', headers: { cookie: allowedCookie }, payload: { email: 'sixth@example.test' },
    });
    expect(overLimitInvite.statusCode).toBe(409);
    expect(overLimitInvite.json()).toMatchObject({ error: 'admin_limit_reached' });
    expect(gmailRequests.filter((url) => url.includes('/messages/send'))).toHaveLength(5);
    const roster = await app.inject({ method: 'GET', url: '/api/admin/staff', headers: { cookie: allowedCookie } });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().maxAdmins).toBe(5);
    expect(roster.json().admins).toHaveLength(5);
    expect(roster.json().admins.map((admin: { email: string }) => admin.email)).toEqual(expect.arrayContaining(['cmoyle@gmail.com', 'nicole@example.test', 'new-admin@example.test']));
    expect(await app.testDeps.mailer.send({
      to: 'parent@example.test', subject: 'Registration verification',
      text: 'Open https://test.example/manage-registration#token=synthetic',
    })).toBe('simulated');
    const populatedOutbox = await app.inject({ method: 'GET', url: '/api/admin/test-email-outbox', headers: { cookie: allowedCookie } });
    expect(populatedOutbox.json()).toMatchObject([{ to: 'parent@example.test', subject: 'Registration verification', body: expect.stringContaining('/manage-registration#token=synthetic') }]);

    const denied = await app.inject({ method: 'GET', url: '/api/public/events', headers: { cookie: 'nt_session=not-a-session' } });
    expect(denied.statusCode).toBe(401);
  });
});
