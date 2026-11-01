import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { loadEnv } from '../../env';
import { IntegrationSettings } from '../../integrations/settings';

afterEach(() => vi.restoreAllMocks());

function infisicalEnv() {
  return loadEnv({
    NODE_ENV: 'development', PAYMENT_PROVIDER: 'fake',
    INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'machine-id', INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'machine-secret',
    INFISICAL_PROJECT_ID: 'project', INFISICAL_ENVIRONMENT: 'test',
  } as NodeJS.ProcessEnv);
}

describe('Infisical integration runtime', () => {
  it('loads credentials into the live providers before the API accepts traffic', async () => {
    const env = infisicalEnv();
    const settings = new IntegrationSettings(env);
    expect(settings.mode).toBe('infisical');
    vi.spyOn(settings, 'readCredentials').mockResolvedValue({
      stripe: { secretKey: 'sk_test_not-a-real-key', webhookSecret: 'whsec_not-a-real-secret' },
      gmail: { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' },
    });
    const app = createApp({ env, integrationSettings: settings });
    try {
      await app.ready();
      expect('checkouts' in app.testDeps.payment).toBe(false);
      expect(app.testDeps.mailer).toMatchObject({ provider: 'gmail-api' });
    } finally {
      await app.close();
    }
  });

  it('keeps connection details available when Infisical is unreachable so Admins can repair them', async () => {
    const settings = new IntegrationSettings(infisicalEnv(), async () => { throw new Error('offline'); });
    const status = await settings.status();
    expect(status.infisical).toMatchObject({ configured: true, connected: false, projectId: 'project', environment: 'test' });
  });

  it('tests and applies only allow-listed Infisical Cloud connection settings', async () => {
    const stripe = JSON.stringify({ secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake' });
    const gmail = JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' });
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/universal-auth/login')) {
        return new Response(JSON.stringify({ accessToken: 'test-token', expiresIn: 3600 }), { status: 200 });
      }
      if (url.includes('/STRIPE_INTEGRATION?')) return new Response(JSON.stringify({ secret: { secretValue: stripe, updatedAt: '2026-10-31T00:00:00.000Z' } }), { status: 200 });
      if (url.includes('/GMAIL_INTEGRATION?')) return new Response(JSON.stringify({ secret: { secretValue: gmail, updatedAt: '2026-10-31T00:00:00.000Z' } }), { status: 200 });
      return new Response('', { status: 404 });
    };
    const settings = new IntegrationSettings(infisicalEnv(), fetcher);
    const connection = { apiUrl: 'https://eu.infisical.com', projectId: 'new-project', environment: 'test', secretPath: '/netball-trials' };
    const status = await settings.testConnection(connection);
    expect(status).toMatchObject({ stripe: { configured: true }, gmail: { configured: true } });
    settings.configureConnection(connection, '2026-10-31T00:00:00.000Z');
    expect(settings.connectionSettings()).toEqual({ configured: true, connected: false, ...connection, updatedAt: '2026-10-31T00:00:00.000Z' });
    await expect(settings.testConnection({ ...connection, apiUrl: 'http://127.0.0.1' })).rejects.toThrow(/invalid infisical connection/i);
  });
});
