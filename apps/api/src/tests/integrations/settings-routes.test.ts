import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { loadEnv } from '../../env';
import { IntegrationSettings } from '../../integrations/settings';
import { signInAsNewAdmin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'integration-settings-admin@example.test');
});

afterAll(async () => { await app.close(); });

describe('integration settings routes', () => {
  it('reports fake integrations in the local test environment without exposing credential fields', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/settings/integrations', cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'fake',
      infisical: { configured: false, connected: false, apiUrl: null, projectId: null, environment: null, secretPath: null, updatedAt: null },
      stripe: { configured: false, updatedAt: null },
      gmail: { configured: false, updatedAt: null },
    });
    expect(response.body).not.toContain('secretValue');
    expect(response.body).not.toContain('clientSecret');
    expect(response.body).not.toContain('refreshToken');
  });

  it('tests and persists non-secret Infisical connection settings without persisting identity credentials', async () => {
    const env = loadEnv({
      NODE_ENV: 'development', APP_ENV: 'testing', PAYMENT_PROVIDER: 'fake',
      INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'machine-id', INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'machine-secret',
      INFISICAL_PROJECT_ID: 'bootstrap-project', INFISICAL_ENVIRONMENT: 'test',
    } as NodeJS.ProcessEnv);
    const settings = new IntegrationSettings(env);
    Object.defineProperty(settings, 'mode', { value: 'infisical' });
    vi.spyOn(settings, 'readCredentials').mockResolvedValue({ stripe: null, gmail: null });
    const testConnection = vi.spyOn(settings, 'testConnection')
      .mockResolvedValueOnce({
        stripe: { secretKey: 'sk_live_fake', webhookSecret: 'whsec_fake' },
        gmail: { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' },
      })
      .mockResolvedValue({ stripe: null, gmail: { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' } });
    vi.spyOn(settings, 'status').mockImplementation(async () => ({
      mode: 'infisical', infisical: settings.connectionSettings(),
      stripe: { configured: true, updatedAt: null }, gmail: { configured: true, updatedAt: null },
    }));
    const infisicalApp = createApp({ env, integrationSettings: settings });
    try {
      const infisicalCookie = await signInAsNewAdmin(infisicalApp, 'infisical-settings-admin@example.test');
      const response = await infisicalApp.inject({
        method: 'PUT', url: '/api/admin/settings/integrations/infisical', cookies: { nt_session: infisicalCookie },
        payload: { apiUrl: 'https://eu.infisical.com', projectId: 'target-project', environment: 'test', secretPath: '/netball-trials' },
      });
      expect(response.statusCode).toBe(200);
      expect(testConnection).toHaveBeenCalledWith({ apiUrl: 'https://eu.infisical.com', projectId: 'target-project', environment: 'test', secretPath: '/netball-trials' });
      expect('checkouts' in infisicalApp.testDeps.payment).toBe(false);
      expect(infisicalApp.testDeps.mailer).toMatchObject({ provider: 'gmail-api' });
      expect(response.json().infisical).toMatchObject({ configured: true, apiUrl: 'https://eu.infisical.com', projectId: 'target-project', environment: 'test', secretPath: '/netball-trials' });
      expect(response.body).not.toContain('machine-secret');
      expect(response.body).not.toContain('client-secret');
      expect(response.body).not.toContain('refresh-token');
      expect(response.body).not.toContain('sk_live_fake');
      expect(response.body).not.toContain('whsec_fake');
      expect(await prisma.infisicalConnectionSettings.findUnique({ where: { id: 'infisical' } })).toMatchObject({
        apiUrl: 'https://eu.infisical.com', projectId: 'target-project', environment: 'test', secretPath: '/netball-trials',
      });
      const missingSecrets = await infisicalApp.inject({
        method: 'PUT', url: '/api/admin/settings/integrations/infisical', cookies: { nt_session: infisicalCookie },
        payload: { apiUrl: 'https://us.infisical.com', projectId: 'empty-project', environment: 'test', secretPath: '/netball-trials' },
      });
      expect(missingSecrets.statusCode).toBe(409);
      expect(missingSecrets.json()).toEqual({ error: 'infisical_provider_secrets_missing' });
      expect(await prisma.infisicalConnectionSettings.findUnique({ where: { id: 'infisical' } })).toMatchObject({ projectId: 'target-project' });
    } finally {
      await infisicalApp.close();
    }
  });

  it('does not allow Infisical connection changes in the fake test environment', async () => {
    const response = await app.inject({
      method: 'PUT', url: '/api/admin/settings/integrations/infisical', cookies: { nt_session: cookie },
      payload: { apiUrl: 'https://us.infisical.com', projectId: 'project', environment: 'test', secretPath: '/netball-trials' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'infisical_identity_not_configured' });
  });

  it('does not allow live integration credentials to be stored from the fake test environment', async () => {
    const response = await app.inject({
      method: 'PUT', url: '/api/admin/settings/integrations/stripe', cookies: { nt_session: cookie },
      payload: { secretKey: 'sk_test_not-a-real-key', webhookSecret: 'whsec_not-a-real-secret' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'secret_store_not_configured' });
    expect(response.body).not.toContain('not-a-real');
  });
});
