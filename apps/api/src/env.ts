import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgresql://postgres:postgres@localhost:5432/netballtrials'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:3000'),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  MAIL_FROM: z.string().default('trials@chisholmnetball.com'),
  MAIL_REPLY_TO: z.string().default('chisholmnetball@gmail.com'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = {
  DATABASE_URL: string;
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
  return { ...parsed, SESSION_COOKIE_SECURE: parsed.SESSION_COOKIE_SECURE === 'true' };
}
