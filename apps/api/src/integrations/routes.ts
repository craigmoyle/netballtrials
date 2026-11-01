import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { IntegrationSettingsUnavailableError } from './settings';
import { INFISICAL_CLOUD_API_URLS } from './infisical';

const stripeSchema = z.object({
  secretKey: z.string().trim().min(1).max(500),
  webhookSecret: z.string().trim().min(1).max(500),
});
const gmailSchema = z.object({
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().trim().min(1).max(500),
  refreshToken: z.string().trim().min(1).max(2_000),
});
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
      const test = await settings.testConnection(parsed.data);
      if (!test.stripe.configured || !test.gmail.configured) {
        return reply.code(409).send({ error: 'infisical_provider_secrets_missing' });
      }
      const saved = await deps.prisma.infisicalConnectionSettings.upsert({
        where: { id: 'infisical' },
        create: { id: 'infisical', ...parsed.data },
        update: parsed.data,
      });
      settings.configureConnection(parsed.data, saved.updatedAt);
      await deps.reloadIntegrations?.();
      return settings.status();
    } catch {
      return reply.code(502).send({ error: 'infisical_connection_failed' });
    }
  });

  app.put('/api/admin/settings/integrations/stripe', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = stripeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    if (!parsed.data.secretKey.startsWith('sk_') || !parsed.data.webhookSecret.startsWith('whsec_')) {
      return reply.code(400).send({ error: 'stripe_credentials_invalid' });
    }
    if (!deps.integrationSettings || deps.integrationSettings.mode !== 'infisical') {
      return reply.code(409).send({ error: 'secret_store_not_configured' });
    }
    try {
      await deps.integrationSettings.replaceStripe(parsed.data);
      await deps.reloadIntegrations?.();
      return deps.integrationSettings.status();
    } catch (error) {
      if (error instanceof IntegrationSettingsUnavailableError) return reply.code(409).send({ error: 'secret_store_not_configured' });
      return reply.code(502).send({ error: 'integration_update_failed' });
    }
  });

  app.put('/api/admin/settings/integrations/gmail', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = gmailSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    if (!deps.integrationSettings || deps.integrationSettings.mode !== 'infisical') {
      return reply.code(409).send({ error: 'secret_store_not_configured' });
    }
    try {
      await deps.integrationSettings.replaceGmail(parsed.data);
      await deps.reloadIntegrations?.();
      return deps.integrationSettings.status();
    } catch {
      return reply.code(502).send({ error: 'integration_update_failed' });
    }
  });
}
