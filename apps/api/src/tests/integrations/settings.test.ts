import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { loadEnv } from '../../env';
import { IntegrationSettings } from '../../integrations/settings';

afterEach(() => vi.restoreAllMocks());

describe('Infisical integration runtime', () => {
  it('loads credentials into the live providers before the API accepts traffic', async () => {
    const env = loadEnv({
      NODE_ENV: 'development', PAYMENT_PROVIDER: 'fake',
      INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'machine-id', INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'machine-secret',
      INFISICAL_PROJECT_ID: 'project', INFISICAL_ENVIRONMENT: 'test',
    } as NodeJS.ProcessEnv);
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
});
