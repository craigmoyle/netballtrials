import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { melbourneLocalDateTimeToUtc } from '../time/melbourne';
import { EmailBatchConflictError } from './service';
import { unsupportedTemplateFields } from './template-renderer';
import {
  cancelSiteAssociationCommunication,
  createSiteAssociationCommunication,
  listSiteAssociationCommunications,
  previewSiteAssociationCommunication,
  retrySiteAssociationCommunication,
} from './site-association-communications';

const selectionFields = {
  eventIds: z.array(z.string().min(1)).min(1).max(100),
  associationIds: z.array(z.string().min(1)).min(1).max(500),
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(5000),
};
const previewSchema = z.object(selectionFields);
const sendSchema = z.object({ ...selectionFields, batchId: z.uuid().optional() });
const scheduleSchema = z.object({ ...selectionFields, batchId: z.uuid().optional(), scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) });
const retrySchema = z.object({ deliveryIds: z.array(z.string().min(1)).min(1).max(500), includeAmbiguous: z.boolean().default(false) });

function validateTemplateFields(reply: { code(status: number): { send(body: unknown): unknown } }, audience: 'associations', subject: string, text: string): unknown | null {
  const fields = unsupportedTemplateFields(audience, subject, text);
  return fields.length ? reply.code(400).send({ error: 'unsupported_template_fields', fields }) : null;
}

export function registerSiteAssociationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/communications/site/campaigns', { preHandler: requireAdmin(deps) }, async () =>
    listSiteAssociationCommunications(deps.prisma));

  app.post('/api/admin/communications/site/preview', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = previewSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const invalidFields = validateTemplateFields(reply, 'associations', parsed.data.subject, parsed.data.text);
    if (invalidFields) return invalidFields;
    const preview = await previewSiteAssociationCommunication(deps.prisma, parsed.data, new Date());
    if (!preview) return reply.code(422).send({ error: 'no_eligible_recipients_or_events' });
    return { ...preview, count: preview.recipients.length };
  });

  app.post('/api/admin/communications/site/send', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const invalidFields = validateTemplateFields(reply, 'associations', parsed.data.subject, parsed.data.text);
    if (invalidFields) return invalidFields;
    try {
      const campaign = await createSiteAssociationCommunication({ prisma: deps.prisma, mailer: deps.mailer }, {
        eventIds: parsed.data.eventIds,
        associationIds: parsed.data.associationIds,
        subject: parsed.data.subject,
        text: parsed.data.text,
        senderUserId: req.adminUserId,
        batchId: parsed.data.batchId,
      }, new Date());
      if (!campaign) return reply.code(422).send({ error: 'no_eligible_recipients_or_events' });
      return campaign;
    } catch (error) {
      if (error instanceof EmailBatchConflictError) return reply.code(409).send({ error: 'idempotency_conflict' });
      return reply.code(502).send({ error: 'communication_send_failed' });
    }
  });

  app.post('/api/admin/communications/site/schedule', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = scheduleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const invalidFields = validateTemplateFields(reply, 'associations', parsed.data.subject, parsed.data.text);
    if (invalidFields) return invalidFields;
    let scheduledAt: Date;
    try { scheduledAt = melbourneLocalDateTimeToUtc(parsed.data.scheduledLocal); }
    catch { return reply.code(400).send({ error: 'invalid_schedule_time' }); }
    if (scheduledAt.getTime() < Date.now() + 60_000) return reply.code(400).send({ error: 'schedule_must_be_in_future' });
    const campaign = await createSiteAssociationCommunication({ prisma: deps.prisma, mailer: deps.mailer }, {
      eventIds: parsed.data.eventIds,
      associationIds: parsed.data.associationIds,
      subject: parsed.data.subject,
      text: parsed.data.text,
      scheduledAt,
      senderUserId: req.adminUserId,
      batchId: parsed.data.batchId,
    }, new Date());
    if (!campaign) return reply.code(422).send({ error: 'no_eligible_recipients_or_events' });
    return reply.code(201).send(campaign);
  });

  app.post('/api/admin/communications/site/campaigns/:id/cancel', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cancelled = await cancelSiteAssociationCommunication(deps.prisma, id, new Date());
    if (!cancelled) return reply.code(409).send({ error: 'schedule_not_cancellable' });
    return { status: 'CANCELLED' };
  });

  app.post('/api/admin/communications/site/campaigns/:id/retry', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = retrySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    const result = await retrySiteAssociationCommunication(deps.prisma, { mailer: deps.mailer }, id, parsed.data.deliveryIds, new Date(), parsed.data.includeAmbiguous);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });
}
