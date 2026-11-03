import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env';

const production = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_prod',
  NODE_ENV: 'production',
  PAYMENT_PROVIDER: 'stripe',
  WEB_ORIGIN: 'https://trials.example',
  API_PUBLIC_URL: 'https://api.example',
  SESSION_COOKIE_SECURE: 'true',
  STRIPE_SECRET_KEY: 'sk_live_configured',
  STRIPE_WEBHOOK_SECRET: 'whsec_configured',
};

const hostedTest = {
  DATABASE_URL: 'postgresql://test:test@db.example/netballtrials_test',
  NODE_ENV: 'production',
  APP_ENV: 'testing',
  PAYMENT_PROVIDER: 'stripe',
  SESSION_COOKIE_SECURE: 'true',
  WEB_ORIGIN: 'https://test.example',
  API_PUBLIC_URL: 'https://api.test.example',
  ENABLE_TEST_INTEGRATIONS: 'true',
  TEST_ADMIN_EMAILS: 'cmoyle@gmail.com,nicole@example.test',
  TEST_EMAIL_ALLOWLIST: 'cmoyle@gmail.com,nicole@example.test',
  MAIL_FROM: 'cmoyle@gmail.com',
  MAIL_REPLY_TO: 'cmoyle@gmail.com',
  INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'test-client-id',
  INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'test-client-secret',
  INFISICAL_PROJECT_ID: 'test-project',
  INFISICAL_ENVIRONMENT: 'test',
  INFISICAL_SECRET_PATH: '/',
};

describe('deployment environment config', () => {
  it('allows hosted test integrations only with the test database, HTTPS, Infisical test namespace and strict email allowlist', () => {
    const env = loadEnv(hostedTest as NodeJS.ProcessEnv);
    expect(env).toMatchObject({
      APP_ENV: 'testing', PAYMENT_PROVIDER: 'stripe', ENABLE_TEST_INTEGRATIONS: true,
      TEST_ADMIN_EMAILS: ['cmoyle@gmail.com', 'nicole@example.test'],
      TEST_EMAIL_ALLOWLIST: ['cmoyle@gmail.com', 'nicole@example.test'], MAIL_FROM: 'cmoyle@gmail.com',
    });
  });

  it('rejects live or direct provider credentials in hosted integration testing', () => {
    expect(() => loadEnv({ ...hostedTest, STRIPE_SECRET_KEY: 'sk_live_configured' } as NodeJS.ProcessEnv)).toThrow(/sk_test_|Infisical test namespace/i);
    expect(() => loadEnv({ ...hostedTest, STRIPE_SECRET_KEY: 'sk_test_configured', STRIPE_WEBHOOK_SECRET: 'whsec_test' } as NodeJS.ProcessEnv)).toThrow(/Infisical test namespace/i);
    expect(() => loadEnv({ ...hostedTest, GMAIL_REFRESH_TOKEN: 'direct-secret' } as NodeJS.ProcessEnv)).toThrow(/Infisical test namespace/i);
  });

  it('delivers real test email only to the full Admin allowlist and keeps the test mailbox as sender', () => {
    expect(loadEnv({ ...hostedTest, TEST_ADMIN_EMAILS: 'cmoyle@gmail.com,nicole@example.test', TEST_EMAIL_ALLOWLIST: 'cmoyle@gmail.com,nicole@example.test' } as NodeJS.ProcessEnv).TEST_EMAIL_ALLOWLIST)
      .toEqual(['cmoyle@gmail.com', 'nicole@example.test']);
    const fiveAdmins = 'cmoyle@gmail.com,a@example.test,b@example.test,c@example.test,d@example.test';
    expect(loadEnv({ ...hostedTest, TEST_ADMIN_EMAILS: fiveAdmins, TEST_EMAIL_ALLOWLIST: fiveAdmins } as NodeJS.ProcessEnv).TEST_EMAIL_ALLOWLIST).toHaveLength(5);
    expect(() => loadEnv({ ...hostedTest, TEST_EMAIL_ALLOWLIST: 'cmoyle@gmail.com' } as NodeJS.ProcessEnv)).toThrow(/match the TEST Admin allowlist/i);
    expect(() => loadEnv({ ...hostedTest, TEST_EMAIL_ALLOWLIST: 'cmoyle@gmail.com,other@example.test' } as NodeJS.ProcessEnv)).toThrow(/match the TEST Admin allowlist/i);
    expect(() => loadEnv({ ...hostedTest, TEST_ADMIN_EMAILS: 'a@x.test,b@x.test,c@x.test,d@x.test,e@x.test,f@x.test' } as NodeJS.ProcessEnv)).toThrow(/one to five/i);
    expect(() => loadEnv({ ...hostedTest, MAIL_REPLY_TO: 'other@example.test' } as NodeJS.ProcessEnv)).toThrow(/cmoyle@gmail.com/i);
  });

  it('requires an Admin allowlist for every hosted TEST deployment, even when providers stay fake', () => {
    expect(() => loadEnv({ ...hostedTest, ENABLE_TEST_INTEGRATIONS: 'false', PAYMENT_PROVIDER: 'fake', TEST_ADMIN_EMAILS: '' } as NodeJS.ProcessEnv)).toThrow(/hosted test access requires/i);
    expect(loadEnv({ ...hostedTest, ENABLE_TEST_INTEGRATIONS: 'false', PAYMENT_PROVIDER: 'fake' } as NodeJS.ProcessEnv)).toMatchObject({
      APP_ENV: 'testing', ENABLE_TEST_INTEGRATIONS: false, TEST_ADMIN_EMAILS: ['cmoyle@gmail.com', 'nicole@example.test'],
    });
  });

  it('requires test integrations to use APP_ENV=testing, production Node, and the Infisical test namespace', () => {
    expect(() => loadEnv({ ...hostedTest, APP_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/hosted testing deployment/i);
    expect(() => loadEnv({ ...hostedTest, NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toThrow(/hosted testing deployment/i);
    expect(() => loadEnv({ ...hostedTest, INFISICAL_ENVIRONMENT: 'prod' } as NodeJS.ProcessEnv)).toThrow(/test namespace/i);
  });

  it('requires an explicit database URL in production', () => {
    const source = { ...production } as NodeJS.ProcessEnv;
    delete source.DATABASE_URL;
    expect(() => loadEnv(source)).toThrow(/DATABASE_URL.*production/i);
  });

  it('separates hosted test and production databases', () => {
    expect(() => loadEnv({ ...production, APP_ENV: 'testing', PAYMENT_PROVIDER: 'fake' } as NodeJS.ProcessEnv)).toThrow(/database name ending in _test/i);
    expect(() => loadEnv({ ...production, DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_test' } as NodeJS.ProcessEnv))
      .toThrow(/cannot use a _test database/i);
    expect(loadEnv({ ...production, APP_ENV: 'testing', PAYMENT_PROVIDER: 'fake', TEST_ADMIN_EMAILS: 'cmoyle@gmail.com', DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netballtrials_test' } as NodeJS.ProcessEnv).APP_ENV).toBe('testing');
  });

  it('rejects Stripe test keys in production', () => {
    expect(() => loadEnv({ ...production, STRIPE_SECRET_KEY: 'sk_test_configured' } as NodeJS.ProcessEnv)).toThrow(/production.*live Stripe|sk_live/i);
  });

  it('requires Gmail OAuth credentials for production unless they are supplied by Infisical', () => {
    expect(() => loadEnv(production as NodeJS.ProcessEnv)).toThrow(/GMAIL_CLIENT_ID|GMAIL_REFRESH_TOKEN|Gmail OAuth/i);
    expect(loadEnv({
      ...production, GMAIL_CLIENT_ID: 'client-id', GMAIL_CLIENT_SECRET: 'client-secret', GMAIL_REFRESH_TOKEN: 'refresh-token',
    } as NodeJS.ProcessEnv).GMAIL_REFRESH_TOKEN).toBe('refresh-token');
  });

  it('allows production integrations to come from Infisical instead of app environment values', () => {
    const env = loadEnv({
      ...production, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
      INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: 'machine-client-id',
      INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: 'machine-client-secret',
      INFISICAL_PROJECT_ID: 'project-id', INFISICAL_ENVIRONMENT: 'prod',
    } as NodeJS.ProcessEnv);
    expect(env.INFISICAL_PROJECT_ID).toBe('project-id');
    expect(env.STRIPE_SECRET_KEY).toBe('');
  });
});
