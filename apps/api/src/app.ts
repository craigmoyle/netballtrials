import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { PrismaClient } from '@prisma/client';
import { loadEnv, type Env } from './env';
import { prisma as defaultPrisma } from './db';
import { createDevMailer } from './mail/dev-mailer';
import { createGmailMailer } from './mail/gmail-mailer';
import type { EmailProvider } from './mail/provider';
import type { PaymentProvider } from './payments/provider';
import { createFakePaymentProvider } from './payments/fake';
import { createStripePaymentProvider } from './payments/stripe';
import { registerAuthRoutes } from './auth/routes';
import { registerEventRoutes } from './events/routes';
import { registerAssociationRoutes } from './associations/routes';
import { registerPublicRoutes } from './public/routes';
import { registerCheckInRoutes } from './checkin/routes';
import { registerPlannerRoutes } from './planner/routes';
import { registerReviewRoutes } from './review/routes';
import { registerRosterRoutes } from './roster/routes';

export type AppDeps = {
  prisma: PrismaClient;
  mailer: EmailProvider;
  env: Env;
  payment: PaymentProvider;
};

declare module 'fastify' {
  interface FastifyInstance {
    testDeps: AppDeps;
  }
}

export function createApp(overrides: Partial<AppDeps> = {}): FastifyInstance {
  const env = overrides.env ?? loadEnv();
  const hasStripeSecret = env.STRIPE_SECRET_KEY.length > 0;
  const hasWebhookSecret = env.STRIPE_WEBHOOK_SECRET.length > 0;
  if (hasStripeSecret !== hasWebhookSecret) {
    throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together');
  }
  if (env.NODE_ENV === 'production') {
    if (env.PAYMENT_PROVIDER !== 'stripe' || !hasStripeSecret || !hasWebhookSecret) {
      throw new Error('Production requires the Stripe payment provider and both Stripe credentials');
    }
    if (!env.SESSION_COOKIE_SECURE) {
      throw new Error('SESSION_COOKIE_SECURE must be true in production');
    }
    if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
      throw new Error('Production requires configured Gmail OAuth credentials');
    }
    if (overrides.payment && 'checkouts' in overrides.payment) {
      throw new Error('The fake payment provider is forbidden in production');
    }
  }

  const payment = overrides.payment ??
    (env.PAYMENT_PROVIDER === 'stripe'
      ? createStripePaymentProvider({
          secretKey: env.STRIPE_SECRET_KEY,
          webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        })
      : createFakePaymentProvider());
  const mailer = overrides.mailer ?? (env.NODE_ENV === 'production'
    ? createGmailMailer({
        clientId: env.GMAIL_CLIENT_ID,
        clientSecret: env.GMAIL_CLIENT_SECRET,
        refreshToken: env.GMAIL_REFRESH_TOKEN,
      })
    : createDevMailer([]));
  if (env.NODE_ENV === 'production' && (!('provider' in mailer) || mailer.provider !== 'gmail-api')) {
    throw new Error('Production requires the Gmail API mail provider');
  }

  const deps: AppDeps = {
    env,
    prisma: overrides.prisma ?? defaultPrisma,
    mailer,
    payment,
  };

  const webOrigin = new URL(env.WEB_ORIGIN).origin;
  const trustedProxies = env.TRUST_PROXY.split(',').map((value) => value.trim()).filter(Boolean);
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
  app.decorate('testDeps', deps);

  app.register(cors, { origin: webOrigin, credentials: true });
  app.register(cookie);

  app.addHook('preHandler', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (!request.cookies?.nt_session && !request.cookies?.nt_checkin) return;

    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if ((origin && origin !== webOrigin) || fetchSite === 'cross-site') {
      return reply.code(403).send({ error: 'origin_forbidden' });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store, max-age=0');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerAuthRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerAssociationRoutes(app, deps);
  registerPublicRoutes(app, deps);
  registerCheckInRoutes(app, deps);
  registerPlannerRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerRosterRoutes(app, deps);

  return app;
}
