import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env';

describe('production environment config', () => {
  const base = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_test',
    NODE_ENV: 'production',
    PAYMENT_PROVIDER: 'stripe',
    WEB_ORIGIN: 'https://trials.example',
    API_PUBLIC_URL: 'https://api.example',
    SESSION_COOKIE_SECURE: 'true',
    STRIPE_SECRET_KEY: 'sk_test_configured',
    STRIPE_WEBHOOK_SECRET: 'whsec_configured',
  };

  it('requires an explicit database URL in production', () => {
    const source = { ...base } as NodeJS.ProcessEnv;
    delete source.DATABASE_URL;
    expect(() => loadEnv(source)).toThrow(/DATABASE_URL.*production/i);
  });

  it('requires client ID, client secret, and refresh token for production Gmail', () => {
    expect(() => loadEnv(base as NodeJS.ProcessEnv)).toThrow(/GMAIL_CLIENT_ID|GMAIL_REFRESH_TOKEN|Gmail OAuth/i);
    expect(loadEnv({
      ...base,
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
    } as NodeJS.ProcessEnv).GMAIL_REFRESH_TOKEN).toBe('refresh-token');
  });

  it('allows production integrations to come from Infisical instead of app environment values', () => {
    const env = loadEnv({
      ...base,
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'machine-client-id',
      INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'machine-client-secret',
      INFISICAL_PROJECT_ID: 'project-id',
      INFISICAL_ENVIRONMENT: 'prod',
    } as NodeJS.ProcessEnv);
    expect(env.INFISICAL_PROJECT_ID).toBe('project-id');
    expect(env.STRIPE_SECRET_KEY).toBe('');
  });
});
