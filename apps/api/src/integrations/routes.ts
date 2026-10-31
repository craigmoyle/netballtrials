import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { IntegrationSettingsUnavailableError } from './settings';

const stripeSchema = z.object({
  secretKey: z.string().trim().min(1).max(500),
  webhookSecret: z.string().trim().min(1).max(500),
});
const gmailSchema = z.object({
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().trim().min(1).max(500),
  refreshToken: z.string().trim().min(1).max(2_000),
});

export function registerIntegrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/settings/integrations', { preHandler: requireAdmin(deps) }, async (_req, reply) => {
    if (!deps.integrationSettings) return reply.code(503).send({ error: 'integration_settings_unavailable' });
    return deps.integrationSettings.status();
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
