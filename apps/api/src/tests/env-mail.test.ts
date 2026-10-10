import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env';

describe('Gmail OAuth production config', () => {
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

  it('requires client ID, client secret, and refresh token for production Gmail', () => {
    expect(() => loadEnv(base as NodeJS.ProcessEnv)).toThrow(/GMAIL_CLIENT_ID|GMAIL_REFRESH_TOKEN|Gmail OAuth/i);
    expect(loadEnv({
      ...base,
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
    } as NodeJS.ProcessEnv).GMAIL_REFRESH_TOKEN).toBe('refresh-token');
  });
});
