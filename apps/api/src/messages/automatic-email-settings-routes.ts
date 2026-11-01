import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { getAutomaticEmailSettings, saveAutomaticEmailSettings, validateAutomaticEmailTemplates } from './automatic-email-settings';

const settingsSchema = z.object({
  confirmationSubject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value)),
  confirmationBody: z.string().trim().min(1).max(3_000),
  reminderSubject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value)),
  reminderBody: z.string().trim().min(1).max(3_000),
  reminderLeadHours: z.number().int().min(1).max(168),
}).strict();

export function registerAutomaticEmailSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/settings/automatic-email', { preHandler: requireAdmin(deps) }, () =>
    getAutomaticEmailSettings(deps.prisma),
  );

  app.put('/api/admin/settings/automatic-email', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const invalidFields = validateAutomaticEmailTemplates(parsed.data);
    if (invalidFields.length > 0) return reply.code(400).send({ error: 'invalid_email_template', fields: invalidFields });
    return saveAutomaticEmailSettings(deps.prisma, parsed.data);
  });
}
