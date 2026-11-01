import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';
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
import { registerBibColorRoutes } from './colors/routes';
import { registerPublicRoutes } from './public/routes';
import { registerAdminRegistrationRoutes } from './registrations/admin-routes';
import { registerRegistrationOverviewRoutes } from './registrations/overview-routes';
import { registerCheckInRoutes } from './checkin/routes';
import { registerPlannerRoutes } from './planner/routes';
import { registerReviewRoutes } from './review/routes';
import { registerCommunicationRoutes } from './messages/communications-routes';
import { registerAutomaticEmailSettingsRoutes } from './messages/automatic-email-settings-routes';
import { registerSiteAssociationRoutes } from './messages/site-association-routes';
import { registerPlayerHistoryRoutes } from './history/routes';
import { registerRosterRoutes } from './roster/routes';
import { registerParentAccessRoutes } from './parents/routes';
import { assertNoUnverifiedPendingCheckouts } from './registrations/checkout';
import { IntegrationSettings } from './integrations/settings';
import type { IntegrationCredentials } from './integrations/infisical';
import { registerIntegrationRoutes } from './integrations/routes';

export type AppDeps = {
  prisma: PrismaClient;
  mailer: EmailProvider;
  env: Env;
  payment: PaymentProvider;
  integrationSettings?: IntegrationSettings;
  reloadIntegrations?: () => Promise<void>;
  prepareIntegrationUpdate?: (credentials: Partial<IntegrationCredentials>) => () => void;
  /** Application logger; silent in tests. Never pass request bodies or PII. */
  log?: Pick<FastifyBaseLogger, 'error' | 'warn' | 'info'>;
};

export type AppOptions = {
  /** Destination for structured logs. Enables logging even in tests. */
  logStream?: { write(line: string): void };
};

/**
 * Logs only the HTTP method and matched route pattern. Raw URLs can carry
 * ticket tokens and checkout session ids, and headers carry cookies.
 */
export function serializeRequestForLog(request: Pick<FastifyRequest, 'method'> & { routeOptions?: { url?: string } }) {
  return { method: request.method, route: request.routeOptions?.url };
}

function redactErrorForLog(error: Error & { code?: unknown; statusCode?: unknown }) {
  return {
    type: error.name,
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.statusCode === 'number' ? { statusCode: error.statusCode } : {}),
  };
}

function loggerOptions(env: Env, options: AppOptions): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'test' && !options.logStream) return false;
  return {
    level: 'info',
    ...(options.logStream ? { stream: options.logStream } : {}),
    serializers: {
      req: serializeRequestForLog,
      res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
      // Error messages can echo request bodies (JSON parse errors) or query arguments
      // with personal data (Prisma), so log only the error's type and codes.
      err: redactErrorForLog as never,
    },
    hooks: {
      // Fastify logs errors as (bindings, err.message); drop that message for the same reason.
      logMethod(args, method) {
        const [bindings] = args as unknown[];
        if (bindings && typeof bindings === 'object' && 'err' in bindings && typeof args[1] === 'string') {
          args[1] = 'request error';
        }
        return method.apply(this, args);
      },
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    testDeps: AppDeps;
  }
}

export function createApp(overrides: Partial<AppDeps> = {}, options: AppOptions = {}): FastifyInstance {
  const env = overrides.env ?? loadEnv();
  const integrationSettings = overrides.integrationSettings ?? new IntegrationSettings(env);
  const appEnv = env.APP_ENV;
  const hasStripeSecret = env.STRIPE_SECRET_KEY.length > 0;
  const hasWebhookSecret = env.STRIPE_WEBHOOK_SECRET.length > 0;
  const hasGmailCredentials = Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
  const readsInfisical = appEnv === 'production' && integrationSettings.mode === 'infisical';
  if (hasStripeSecret !== hasWebhookSecret) {
    throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together');
  }
  if (env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE) {
    throw new Error('SESSION_COOKIE_SECURE must be true in production');
  }
  if (appEnv === 'production' && hasStripeSecret && !env.STRIPE_SECRET_KEY.startsWith('sk_live_')) {
    throw new Error('Production requires a live Stripe secret key (sk_live_)');
  }
  if (appEnv === 'production') {
    if (env.PAYMENT_PROVIDER !== 'stripe' || ((!hasStripeSecret || !hasWebhookSecret) && !readsInfisical)) {
      throw new Error('Production requires Stripe credentials from Infisical or the deployment environment');
    }
    if (!hasGmailCredentials && !readsInfisical) {
      throw new Error('Production requires Gmail OAuth credentials from Infisical or the deployment environment');
    }
    if (overrides.payment && 'checkouts' in overrides.payment) {
      throw new Error('The fake payment provider is forbidden in production');
    }
  }

  const payment = overrides.payment ?? (appEnv === 'production' && hasStripeSecret && hasWebhookSecret
    ? createStripePaymentProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET })
    : createFakePaymentProvider());
  const mailer = overrides.mailer ?? (appEnv === 'production' && hasGmailCredentials
    ? createGmailMailer({ clientId: env.GMAIL_CLIENT_ID, clientSecret: env.GMAIL_CLIENT_SECRET, refreshToken: env.GMAIL_REFRESH_TOKEN })
    : createDevMailer([]));
  if (appEnv === 'production' && !readsInfisical && (!('provider' in mailer) || mailer.provider !== 'gmail-api')) {
    throw new Error('Production requires the Gmail API mail provider');
  }

  const database = overrides.prisma ?? defaultPrisma;
  let deps!: AppDeps;
  const prepareIntegrationUpdate = (credentials: Partial<IntegrationCredentials>) => {
    if (appEnv === 'production' && credentials.stripe && !credentials.stripe.secretKey.startsWith('sk_live_')) {
      throw new Error('Production requires a live Stripe secret key (sk_live_)');
    }
    const nextPayment = credentials.stripe ? createStripePaymentProvider(credentials.stripe) : null;
    const nextMailer = credentials.gmail ? createGmailMailer(credentials.gmail) : null;
    return () => {
      if (nextPayment) deps.payment = nextPayment;
      if (nextMailer) deps.mailer = nextMailer;
    };
  };
  let loadedInfisicalUpdatedAt: number | null = null;
  let integrationRefresh: Promise<void> | null = null;
  const reloadIntegrations = async () => {
    const saved = readsInfisical
      ? await database.infisicalConnectionSettings.findUnique({ where: { id: 'infisical' } })
      : null;
    if (saved) integrationSettings.configureConnection({
      apiUrl: saved.apiUrl, projectId: saved.projectId, environment: saved.environment, secretPath: saved.secretPath,
    }, saved.updatedAt);
    const credentials = await integrationSettings.readCredentials();
    prepareIntegrationUpdate(credentials)();
    loadedInfisicalUpdatedAt = saved?.updatedAt.getTime() ?? null;
  };
  const refreshIntegrationsIfChanged = async () => {
    if (!readsInfisical) return;
    integrationRefresh ??= (async () => {
      try {
        const saved = await database.infisicalConnectionSettings.findUnique({ where: { id: 'infisical' }, select: { updatedAt: true } });
        if ((saved?.updatedAt.getTime() ?? null) !== loadedInfisicalUpdatedAt) await reloadIntegrations();
      } catch {
        deps.log?.warn({ code: 'integration_refresh_failed' }, 'integration_refresh_failed');
      }
    })().finally(() => { integrationRefresh = null; });
    await integrationRefresh;
  };
  deps = {
    env,
    prisma: database,
    mailer,
    payment,
    integrationSettings,
    reloadIntegrations,
    prepareIntegrationUpdate,
  };

  const webOrigin = new URL(env.WEB_ORIGIN).origin;
  const trustedProxies = env.TRUST_PROXY.split(',').map((value) => value.trim()).filter(Boolean);
  const app = Fastify({
    logger: loggerOptions(env, options),
    bodyLimit: 1_048_576,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
  deps.log = app.log;
  app.decorate('testDeps', deps);

  app.addHook('onReady', async () => {
    if (readsInfisical) await deps.reloadIntegrations?.();
    if (appEnv !== 'production') return;
    if (!('provider' in deps.mailer) || deps.mailer.provider !== 'gmail-api' || 'checkouts' in deps.payment) {
      throw new Error('Production requires Stripe and Gmail integrations');
    }
    await assertNoUnverifiedPendingCheckouts(deps.prisma);
  });

  // Fastify's default 404 handler logs the raw URL; reply the same way
  // without logging it.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
  });

  app.register(cors, {
    origin: webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.register(cookie);

  app.addHook('preHandler', async (request, reply) => {
    await refreshIntegrationsIfChanged();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (!request.cookies?.nt_session && !request.cookies?.nt_checkin && !request.cookies?.nt_parent) return;

    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if ((origin && origin !== webOrigin) || fetchSite === 'cross-site') {
      return reply.code(403).send({ error: 'origin_forbidden' });
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store, max-age=0');
      reply.header('pragma', 'no-cache');
    }
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  const health = async () => ({ status: 'ok', appEnv: env.APP_ENV });
  app.get('/health', health);
  app.get('/api/health', health);

  registerAuthRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerAutomaticEmailSettingsRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerAssociationRoutes(app, deps);
  registerBibColorRoutes(app, deps);
  registerPublicRoutes(app, deps);
  registerAdminRegistrationRoutes(app, deps);
  registerRegistrationOverviewRoutes(app, deps);
  registerCheckInRoutes(app, deps);
  registerPlannerRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerCommunicationRoutes(app, deps);
  registerSiteAssociationRoutes(app, deps);
  registerPlayerHistoryRoutes(app, deps);
  registerRosterRoutes(app, deps);
  registerParentAccessRoutes(app, deps);

  return app;
}
