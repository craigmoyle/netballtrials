import { z } from 'zod';
import { databaseNameFromUrl } from './validation/database-url';

const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .default('postgresql://postgres:postgres@localhost:5432/netballtrials'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    APP_ENV: z.enum(['testing', 'production']).optional(),
    PAYMENT_PROVIDER: z.enum(['stripe', 'fake']).optional(),
    ENABLE_TEST_INTEGRATIONS: z.enum(['true', 'false']).default('false'),
    TEST_ADMIN_EMAILS: z.string().default(''),
    TEST_EMAIL_ALLOWLIST: z.string().default(''),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    API_PUBLIC_URL: z.url().default('http://localhost:3000'),
    TRUST_PROXY: z.string().default(''),
    SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    MAIL_FROM: z.email().default('chisholmnetball@gmail.com'),
    MAIL_REPLY_TO: z.email().default('chisholmnetball@gmail.com'),
    GMAIL_CLIENT_ID: z.string().default(''),
    GMAIL_CLIENT_SECRET: z.string().default(''),
    GMAIL_REFRESH_TOKEN: z.string().default(''),
    STRIPE_SECRET_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().default(''),
    INFISICAL_API_URL: z.url().default('https://us.infisical.com'),
    INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: z.string().default(''),
    INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: z.string().default(''),
    INFISICAL_PROJECT_ID: z.string().default(''),
    INFISICAL_ENVIRONMENT: z.string().default(''),
    INFISICAL_SECRET_PATH: z.string().default('/'),
    PORT: z.coerce.number().int().positive().default(3000),
  })
  .superRefine((env, context) => {
    const hasStripeSecret = env.STRIPE_SECRET_KEY.length > 0;
    const hasWebhookSecret = env.STRIPE_WEBHOOK_SECRET.length > 0;
    if (hasStripeSecret !== hasWebhookSecret) {
      context.addIssue({
        code: 'custom',
        path: ['STRIPE_WEBHOOK_SECRET'],
        message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together',
      });
    }
    const appEnv = env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'testing');
    const databaseName = databaseNameFromUrl(env.DATABASE_URL) ?? '';
    const testAdminEmails = env.TEST_ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    const testEmailAllowlist = env.TEST_EMAIL_ALLOWLIST.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    const hostedTestMode = appEnv === 'testing' && env.NODE_ENV === 'production';
    const testIntegrationsEnabled = env.ENABLE_TEST_INTEGRATIONS === 'true';
    if (appEnv === 'testing' && env.NODE_ENV === 'production' && !databaseName.endsWith('_test')) {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'A hosted test deployment must use a database name ending in _test' });
    }
    if (appEnv === 'production' && databaseName.endsWith('_test')) {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'A production deployment cannot use a _test database' });
    }
    if (appEnv === 'production' && hasStripeSecret && !env.STRIPE_SECRET_KEY.startsWith('sk_live_')) {
      context.addIssue({ code: 'custom', path: ['STRIPE_SECRET_KEY'], message: 'Production requires a live Stripe secret key (sk_live_)' });
    }
    if (appEnv === 'production' && (env.MAIL_FROM !== 'chisholmnetball@gmail.com' || env.MAIL_REPLY_TO !== 'chisholmnetball@gmail.com')) {
      context.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'Production email must use the Chisholm Netball sender address' });
    }

    const provider = env.PAYMENT_PROVIDER ?? (appEnv === 'testing' ? 'fake' : 'stripe');
    if (appEnv === 'production' && env.NODE_ENV !== 'production') {
      context.addIssue({ code: 'custom', path: ['NODE_ENV'], message: 'A production deployment requires NODE_ENV=production' });
    }
    if (testIntegrationsEnabled && (appEnv !== 'testing' || env.NODE_ENV !== 'production')) {
      context.addIssue({ code: 'custom', path: ['ENABLE_TEST_INTEGRATIONS'], message: 'Test integrations can only be enabled in a hosted testing deployment' });
    }
    if (appEnv === 'testing' && env.NODE_ENV === 'production' && provider !== 'fake' && !testIntegrationsEnabled) {
      context.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Hosted test deployments use fake providers unless test integrations are explicitly enabled' });
    }
    if (hostedTestMode && (testAdminEmails.length === 0 || testAdminEmails.length > 5 || new Set(testAdminEmails).size !== testAdminEmails.length || testAdminEmails.some((email) => !z.email().safeParse(email).success))) {
      context.addIssue({ code: 'custom', path: ['TEST_ADMIN_EMAILS'], message: 'Hosted test access requires one to five unique Admin email addresses' });
    }
    if (testIntegrationsEnabled) {
      if (provider !== 'stripe') context.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Test integration mode requires PAYMENT_PROVIDER=stripe with Stripe test credentials' });
      if (hasStripeSecret && !env.STRIPE_SECRET_KEY.startsWith('sk_test_')) context.addIssue({ code: 'custom', path: ['STRIPE_SECRET_KEY'], message: 'Test integration mode requires an sk_test_ Stripe key' });
      const allowlistMatchesAdmins = testEmailAllowlist.length === testAdminEmails.length &&
        new Set(testEmailAllowlist).size === testEmailAllowlist.length &&
        testAdminEmails.every((email) => testEmailAllowlist.includes(email));
      if (!allowlistMatchesAdmins) {
        context.addIssue({ code: 'custom', path: ['TEST_EMAIL_ALLOWLIST'], message: 'TEST_EMAIL_ALLOWLIST must match the TEST Admin allowlist so only Admins receive real test email' });
      }
      if (env.MAIL_FROM.toLowerCase() !== 'cmoyle@gmail.com' || env.MAIL_REPLY_TO.toLowerCase() !== 'cmoyle@gmail.com') {
        context.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'Hosted TEST email must use the cmoyle@gmail.com test mailbox as sender and reply-to' });
      }
    }
    const hasInfisicalConfig = Boolean(env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID && env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET && env.INFISICAL_PROJECT_ID && env.INFISICAL_ENVIRONMENT);
    if (testIntegrationsEnabled && (!hasInfisicalConfig || env.INFISICAL_ENVIRONMENT.trim().toLowerCase() !== 'test')) {
      context.addIssue({ code: 'custom', path: ['INFISICAL_ENVIRONMENT'], message: 'Test integrations require a dedicated Infisical machine identity and the test namespace' });
    }
    if (testIntegrationsEnabled && (hasStripeSecret || env.GMAIL_CLIENT_ID || env.GMAIL_CLIENT_SECRET || env.GMAIL_REFRESH_TOKEN)) {
      context.addIssue({ code: 'custom', path: ['INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET'], message: 'Test provider credentials must come from the dedicated Infisical test namespace, not environment values' });
    }
    if (provider === 'stripe' && (!hasStripeSecret || !hasWebhookSecret) && !hasInfisicalConfig) {
      context.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'Stripe payment requires both Stripe credentials or a configured Infisical secret store',
      });
    }
    if (provider === 'fake' && appEnv === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'The fake payment provider is forbidden in production',
      });
    }
    if (env.NODE_ENV === 'production' && new URL(env.WEB_ORIGIN).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'WEB_ORIGIN must use HTTPS in production',
      });
    }
    if (env.NODE_ENV === 'production' && new URL(env.API_PUBLIC_URL).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['API_PUBLIC_URL'],
        message: 'API_PUBLIC_URL must use HTTPS in production',
      });
    }
    if (appEnv === 'production' && (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) && !hasInfisicalConfig) {
      context.addIssue({ code: 'custom', path: ['GMAIL_REFRESH_TOKEN'], message: 'Production requires Gmail OAuth credentials or a configured Infisical secret store' });
    }
    if (env.NODE_ENV === 'production' && env.SESSION_COOKIE_SECURE !== 'true') {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'SESSION_COOKIE_SECURE must be true in production',
      });
    }
  });

export type Env = {
  DATABASE_URL: string;
  NODE_ENV: 'development' | 'test' | 'production';
  APP_ENV: 'testing' | 'production';
  PAYMENT_PROVIDER: 'stripe' | 'fake';
  ENABLE_TEST_INTEGRATIONS: boolean;
  TEST_ADMIN_EMAILS: string[];
  TEST_EMAIL_ALLOWLIST: string[];
  WEB_ORIGIN: string;
  API_PUBLIC_URL: string;
  TRUST_PROXY: string;
  SESSION_COOKIE_SECURE: boolean;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  INFISICAL_API_URL: string;
  INFISICAL_UNIVERSAL_AUTH_CLIENT_ID: string;
  INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET: string;
  INFISICAL_PROJECT_ID: string;
  INFISICAL_ENVIRONMENT: string;
  INFISICAL_SECRET_PATH: string;
  PORT: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if ((source.NODE_ENV ?? 'production') === 'production' && !source.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL must be explicitly configured in production');
  }
  const parsed = envSchema.parse(source);
  return {
    ...parsed,
    APP_ENV: parsed.APP_ENV ?? (parsed.NODE_ENV === 'production' ? 'production' : 'testing'),
    PAYMENT_PROVIDER: parsed.PAYMENT_PROVIDER ?? ((parsed.APP_ENV ?? (parsed.NODE_ENV === 'production' ? 'production' : 'testing')) === 'testing' ? 'fake' : 'stripe'),
    ENABLE_TEST_INTEGRATIONS: parsed.ENABLE_TEST_INTEGRATIONS === 'true',
    TEST_ADMIN_EMAILS: parsed.TEST_ADMIN_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
    TEST_EMAIL_ALLOWLIST: parsed.TEST_EMAIL_ALLOWLIST.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
    SESSION_COOKIE_SECURE: parsed.SESSION_COOKIE_SECURE === 'true',
  };
}
