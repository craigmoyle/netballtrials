import { z } from 'zod';

const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .default('postgresql://postgres:postgres@localhost:5432/netballtrials'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PAYMENT_PROVIDER: z.enum(['stripe', 'fake']).optional(),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    API_PUBLIC_URL: z.url().default('http://localhost:3000'),
    SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    MAIL_FROM: z.string().default('chisholmnetball@gmail.com'),
    MAIL_REPLY_TO: z.string().default('chisholmnetball@gmail.com'),
    STRIPE_SECRET_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().default(''),
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

    const provider = env.PAYMENT_PROVIDER ?? (env.NODE_ENV === 'test' ? 'fake' : 'stripe');
    if (provider === 'stripe' && (!hasStripeSecret || !hasWebhookSecret)) {
      context.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'Stripe payment requires both Stripe credentials',
      });
    }
    if (provider === 'fake' && env.NODE_ENV === 'production') {
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
  PAYMENT_PROVIDER: 'stripe' | 'fake';
  WEB_ORIGIN: string;
  API_PUBLIC_URL: string;
  SESSION_COOKIE_SECURE: boolean;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  PORT: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(source);
  return {
    ...parsed,
    PAYMENT_PROVIDER: parsed.PAYMENT_PROVIDER ?? (parsed.NODE_ENV === 'test' ? 'fake' : 'stripe'),
    SESSION_COOKIE_SECURE: parsed.SESSION_COOKIE_SECURE === 'true',
  };
}
