import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import { loadEnv, type Env } from './env';
import { prisma as defaultPrisma } from './db';
import { createDevMailer } from './mail/dev-mailer';
import type { EmailProvider } from './mail/provider';
import { registerAuthRoutes } from './auth/routes';

export type AppDeps = {
  prisma: PrismaClient;
  mailer: EmailProvider;
  env: Env;
};

export function createApp(
  overrides: Partial<AppDeps> = {},
): FastifyInstance & { testDeps: AppDeps } {
  const env = overrides.env ?? loadEnv();
  const deps: AppDeps = {
    env,
    prisma: overrides.prisma ?? defaultPrisma,
    mailer: overrides.mailer ?? createDevMailer([]),
  };

  const app = Fastify({ logger: false });
  app.decorate('testDeps', deps);

  app.register(cors, { origin: env.WEB_ORIGIN });
  app.register(cookie);

  app.get('/health', async () => ({ status: 'ok' }));

  registerAuthRoutes(app, deps);

  return app as FastifyInstance & { testDeps: AppDeps };
}
