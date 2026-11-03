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
  TEST_ADMIN_EMAILS: 'cmoyle@gmail.com,nicole@example.test', TEST_EMAIL_ALLOWLIST: 'cmoyle@gmail.com,nicole@example.test',
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
  it('keeps health and allowlisted sign-in public, gates application data, and exposes only signed webhooks', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ appEnv: 'testing', testAccessRequired: true, testIntegrationsEnabled: true });

    const signIn = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'not-allowlisted@example.test' } });
    expect(signIn.statusCode).toBe(202);
    const oldAdmin = await prisma.staffUser.create({ data: { email: 'old-admin@example.test' } });
    const oldToken = newLoginToken(new Date());
    await prisma.loginToken.create({ data: { userId: oldAdmin.id, tokenHash: oldToken.tokenHash, expiresAt: oldToken.expiresAt } });
    const oldAdminVerify = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: oldToken.token } });
    expect(oldAdminVerify.statusCode).toBe(400);
    expect(await prisma.session.count()).toBe(0);

    const publicData = await app.inject({ method: 'GET', url: '/api/public/events' });
    expect(publicData.statusCode).toBe(401);

    const webhook = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: {} });
    expect(webhook.statusCode).toBe(400);
    expect(webhook.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('sends real email only to Admins and simulates messages to non-Admin addresses', async () => {
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
    const nonAllowlistedInvite = await app.inject({
      method: 'POST', url: '/api/admin/staff/invites', headers: { cookie: allowedCookie },
      payload: { email: 'outsider@example.test' },
    });
    expect(nonAllowlistedInvite.statusCode).toBe(403);
    expect(await app.testDeps.mailer.send({
      to: 'parent@example.test', subject: 'Registration verification',
      text: 'Open https://test.example/manage-registration#token=synthetic',
    })).toBe('simulated');
    const populatedOutbox = await app.inject({ method: 'GET', url: '/api/admin/test-email-outbox', headers: { cookie: allowedCookie } });
    expect(populatedOutbox.json()).toMatchObject([{ to: 'parent@example.test', subject: 'Registration verification', body: expect.stringContaining('/manage-registration#token=synthetic') }]);

    const unallowedCookie = await sessionCookie('not-allowlisted@example.test');
    const denied = await app.inject({ method: 'GET', url: '/api/public/events', headers: { cookie: unallowedCookie } });
    expect(denied.statusCode).toBe(401);
  });
});
