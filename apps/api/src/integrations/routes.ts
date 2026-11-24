import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { INFISICAL_CLOUD_API_URLS } from './infisical';

const infisicalSchema = z.object({
  apiUrl: z.enum(INFISICAL_CLOUD_API_URLS),
  projectId: z.string().trim().min(1).max(200),
  environment: z.string().trim().min(1).max(100),
  secretPath: z.string().trim().min(1).max(500).refine((value) => value.startsWith('/')),
});

export function registerIntegrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/settings/integrations', { preHandler: requireAdmin(deps) }, async (_req, reply) => {
    if (!deps.integrationSettings) return reply.code(503).send({ error: 'integration_settings_unavailable' });
    return deps.integrationSettings.status();
  });

  app.put('/api/admin/settings/integrations/infisical', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = infisicalSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const settings = deps.integrationSettings;
    if (!settings || settings.mode !== 'infisical') return reply.code(409).send({ error: 'infisical_identity_not_configured' });
    try {
      const credentials = await settings.testConnection(parsed.data);
      if (!credentials.stripe || !credentials.gmail) {
        return reply.code(409).send({ error: 'infisical_provider_secrets_missing' });
      }
      if (deps.env.APP_ENV === 'production' && !credentials.stripe.secretKey.startsWith('sk_live_')) {
        return reply.code(400).send({ error: 'stripe_live_key_required' });
      }
      if (deps.env.ENABLE_TEST_INTEGRATIONS && !credentials.stripe.secretKey.startsWith('sk_test_')) {
        return reply.code(400).send({ error: 'stripe_test_key_required' });
      }
      const activate = deps.prepareIntegrationUpdate?.(credentials);
      const saved = await deps.prisma.infisicalConnectionSettings.upsert({
        where: { id: 'infisical' },
        create: { id: 'infisical', ...parsed.data },
        update: parsed.data,
      });
      settings.configureConnection(parsed.data, saved.updatedAt);
      activate?.();
      return settings.status();
    } catch {
      return reply.code(502).send({ error: 'infisical_connection_failed' });
    }
  });
}
