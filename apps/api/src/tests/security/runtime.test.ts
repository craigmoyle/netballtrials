import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../../app';
import { loadEnv } from '../../env';
import { createFakePaymentProvider } from '../../payments/fake';
import { createDevMailer } from '../../mail/dev-mailer';

const previousNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

function env(overrides: Record<string, string> = {}) {
  return loadEnv({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_test',
    NODE_ENV: 'test',
    PAYMENT_PROVIDER: 'fake',
    WEB_ORIGIN: 'http://localhost:5173',
    API_PUBLIC_URL: 'http://localhost:3000',
    TRUST_PROXY: '',
    SESSION_COOKIE_SECURE: 'false',
    MAIL_FROM: 'chisholmnetball@gmail.com',
    MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
    GMAIL_CLIENT_ID: 'gmail-client-id',
    GMAIL_CLIENT_SECRET: 'gmail-client-secret',
    GMAIL_REFRESH_TOKEN: 'gmail-refresh-token',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    PORT: '3000',
    ...overrides,
  });
}

describe('production runtime boundary', () => {
  it('refuses to create the app without both Stripe credentials in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => createApp({ env: env({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'stripe', SESSION_COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://trials.example', API_PUBLIC_URL: 'https://api.example' }) })).toThrow(/Stripe/i);
  });

  it('refuses an incomplete Stripe credential pair', () => {
    process.env.NODE_ENV = 'development';
    expect(() => createApp({ env: env({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_configured' }) })).toThrow(/both|pair|webhook/i);
  });

  it('requires HTTPS public origins in production', () => {
    expect(() => env({
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'stripe',
      SESSION_COOKIE_SECURE: 'true',
      WEB_ORIGIN: 'http://trials.example',
      API_PUBLIC_URL: 'https://api.example',
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_configured',
    })).toThrow(/HTTPS/i);
  });

  it('requires secure cookies in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => createApp({ env: env({
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'stripe',
      SESSION_COOKIE_SECURE: 'false',
      WEB_ORIGIN: 'https://trials.example',
      API_PUBLIC_URL: 'https://api.example',
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_configured',
    }) })).toThrow(/SESSION_COOKIE_SECURE|secure cookie/i);
  });

  it('allows an explicitly injected fake only in test mode', () => {
    process.env.NODE_ENV = 'test';
    const fake = createFakePaymentProvider();
    expect(createApp({ env: env(), payment: fake }).testDeps.payment).toBe(fake);
    expect(() => createApp({ env: env({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'fake', SESSION_COOKIE_SECURE: 'true', WEB_ORIGIN: 'https://trials.example', API_PUBLIC_URL: 'https://api.example' }), payment: fake })).toThrow(/fake.*production|production.*fake/i);
  });

  it('selects Gmail in production and rejects an injected development mailer', async () => {
    const productionEnv = env({
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'stripe',
      SESSION_COOKIE_SECURE: 'true',
      WEB_ORIGIN: 'https://trials.example',
      API_PUBLIC_URL: 'https://api.example',
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_configured',
    });
    const app = createApp({ env: productionEnv });
    expect('provider' in app.testDeps.mailer && app.testDeps.mailer.provider).toBe('gmail-api');
    await app.close();
    expect(() => createApp({ env: productionEnv, mailer: createDevMailer([]) })).toThrow(/Gmail|production.*mail/i);
    expect(() => createApp({ env: productionEnv, mailer: { send: async () => undefined } })).toThrow(/Gmail API/i);
    expect(() => loadEnv({
      ...process.env,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'stripe',
      SESSION_COOKIE_SECURE: 'true',
      WEB_ORIGIN: 'https://trials.example',
      API_PUBLIC_URL: 'https://api.example',
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_configured',
      MAIL_FROM: 'chisholmnetball@gmail.com',
      MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: '',
    })).toThrow(/Gmail OAuth/i);
  });

  it('loads the production server entrypoint and fails before listening without Stripe', () => {
    const cwd = resolve(import.meta.dirname, '../../../');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "import('./src/index.ts')"],
      {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PAYMENT_PROVIDER: 'stripe',
          STRIPE_SECRET_KEY: '',
          STRIPE_WEBHOOK_SECRET: '',
          SESSION_COOKIE_SECURE: 'true',
          MAIL_FROM: 'chisholmnetball@gmail.com',
          MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
          GMAIL_CLIENT_ID: 'gmail-client-id',
          GMAIL_CLIENT_SECRET: 'gmail-client-secret',
          GMAIL_REFRESH_TOKEN: 'gmail-refresh-token',
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_test',
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/STRIPE/i);
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package 'tsx'/);
  });
});

describe('browser security headers and origin policy', () => {
  it('allows credentialed CORS only for the configured origin', async () => {
    const app = createApp({ env: env() });
    try {
      const allowed = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } });
      const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    } finally {
      await app.close();
    }
  });

  it('allows credentialed preflight for admin PUT/PATCH/DELETE controls', async () => {
    const app = createApp({ env: env() });
    try {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const response = await app.inject({
          method: 'OPTIONS', url: '/api/admin/events/event-1/check-in-pin',
          headers: {
            origin: 'http://localhost:5173',
            'access-control-request-method': method,
            'access-control-request-headers': 'content-type',
          },
        });
        expect(response.statusCode).toBe(204);
        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(response.headers['access-control-allow-credentials']).toBe('true');
        expect(response.headers['access-control-allow-methods']).toContain(method);
      }
    } finally {
      await app.close();
    }
  });

  it('rejects a cross-origin cookie-authenticated mutation', async () => {
    const app = createApp({ env: env() });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        cookies: { nt_session: 'attacker-held-session' },
        headers: { origin: 'https://evil.example' },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('marks API responses no-store and emits baseline security headers', async () => {
    const app = createApp({ env: env() });
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
