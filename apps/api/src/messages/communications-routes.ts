import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { localDateTimeToUtc } from '../time/melbourne';
import { EmailBatchConflictError, reconcileStaleDeliveries, retryFailedDeliveries } from './service';
import {
  getScheduledMessages, listCommunicationRecipients, previewSelectedRecipients, sendSelectedCommunication,
  type CommunicationAudience, type SelectedCommunication,
} from './communications';

const audience = z.enum(['participants', 'associations']);
const selectedSchema = z.object({ audience, recipientIds: z.array(z.string().min(1)).max(500) });
const messageFields = {
  audience,
  recipientIds: z.array(z.string().min(1)).max(500),
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(5000),
};
const messageSchema = z.object({ ...messageFields, batchId: z.uuid().optional() });
const scheduleSchema = z.object({
  ...messageFields,
  scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});
const templateSchema = z.object({
  name: z.string().trim().min(1).max(100), audience, subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});
const retrySchema = z.object({ deliveryIds: z.array(z.string().min(1)).min(1).max(500), includeAmbiguous: z.boolean().default(false) });

function selected(data: { audience: CommunicationAudience; recipientIds: string[] }): SelectedCommunication {
  return { audience: data.audience, recipientIds: data.recipientIds };
}

function scheduledLocalToUtc(value: string): Date {
  const [date, time] = value.split('T');
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('invalid_local_date');
  return localDateTimeToUtc(parsedDate, time);
}

export function registerCommunicationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/communications/templates', { preHandler: requireAdmin(deps) }, async () => {
    const templates = await deps.prisma.emailTemplate.findMany({ orderBy: [{ audience: 'asc' }, { name: 'asc' }] });
    return templates.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  });

  app.post('/api/admin/communications/templates', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = templateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    try {
      const created = await deps.prisma.emailTemplate.create({ data: parsed.data });
      return reply.code(201).send({ ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() });
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return reply.code(409).send({ error: 'template_name_exists' });
      throw error;
    }
  });

  app.put('/api/admin/communications/templates/:templateId', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = templateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { templateId } = req.params as { templateId: string };
    try {
      const updated = await deps.prisma.emailTemplate.update({ where: { id: templateId }, data: parsed.data });
      return { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() };
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') return reply.code(409).send({ error: 'template_name_exists' });
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2025') return reply.code(404).send({ error: 'not_found' });
      throw error;
    }
  });

  app.delete('/api/admin/communications/templates/:templateId', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { templateId } = req.params as { templateId: string };
    const result = await deps.prisma.emailTemplate.deleteMany({ where: { id: templateId } });
    return result.count ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/admin/events/:id/communications/recipients', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await listCommunicationRecipients(deps.prisma, id);
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.post('/api/admin/events/:id/communications/preview', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = selectedSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    const recipients = await previewSelectedRecipients(deps.prisma, id, selected(parsed.data));
    if (!recipients) return reply.code(404).send({ error: 'not_found' });
    return { count: recipients.length, recipients };
  });

  app.post('/api/admin/events/:id/communications/send', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = messageSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    const selectedRecipients = selected(parsed.data);
    const preview = await previewSelectedRecipients(deps.prisma, id, selectedRecipients);
    if (!preview) return reply.code(404).send({ error: 'not_found' });
    if (preview.length === 0) return reply.code(422).send({ error: 'no_eligible_recipients' });
    try {
      return await sendSelectedCommunication(
        { prisma: deps.prisma, mailer: deps.mailer }, id, selectedRecipients,
        { subject: parsed.data.subject, text: parsed.data.text }, new Date(),
        { batchId: parsed.data.batchId ?? randomUUID(), senderUserId: req.adminUserId },
      );
    } catch (error) {
      if (error instanceof EmailBatchConflictError) return reply.code(409).send({ error: 'idempotency_conflict' });
      throw error;
    }
  });

  app.post('/api/admin/events/:id/communications/schedule', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = scheduleSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    let scheduledAt: Date;
    try { scheduledAt = scheduledLocalToUtc(parsed.data.scheduledLocal); }
    catch { return reply.code(400).send({ error: 'invalid_schedule_time' }); }
    if (scheduledAt.getTime() < Date.now() + 60_000) return reply.code(400).send({ error: 'schedule_must_be_in_future' });
    const selectedRecipients = selected(parsed.data);
    const preview = await previewSelectedRecipients(deps.prisma, id, selectedRecipients);
    if (!preview) return reply.code(404).send({ error: 'not_found' });
    if (preview.length === 0) return reply.code(422).send({ error: 'no_eligible_recipients' });
    const policyDocument = await deps.prisma.eventPolicyDocument.findUnique({ where: { eventId: id }, select: { fileName: true, bytes: true } });
    const policyAttachment = policyDocument ? { fileName: policyDocument.fileName, contentBase64: Buffer.from(policyDocument.bytes).toString('base64') } : undefined;
    const row = await deps.prisma.scheduledMessage.create({
      data: {
        eventId: id, senderUserId: req.adminUserId, audience: parsed.data.audience,
        recipientIds: [...new Set(parsed.data.recipientIds)], batchId: randomUUID(),
        subject: parsed.data.subject, body: parsed.data.text, scheduledAt,
        ...(policyAttachment ? { policyAttachment } : {}),
      },
    });
    return reply.code(201).send({
      id: row.id, eventId: row.eventId, audience: row.audience, recipientIds: row.recipientIds,
      batchId: row.batchId, subject: row.subject, body: row.body, scheduledAt: row.scheduledAt.toISOString(),
      status: row.status, attempts: row.attempts, error: row.error,
    });
  });

  app.get('/api/admin/events/:id/communications/scheduled', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    return getScheduledMessages(deps.prisma, id);
  });

  app.post('/api/admin/events/:id/communications/scheduled/:scheduleId/cancel', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id, scheduleId } = req.params as { id: string; scheduleId: string };
    const updated = await deps.prisma.scheduledMessage.updateMany({
      where: { id: scheduleId, eventId: id, status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
      data: { status: 'CANCELLED' },
    });
    if (!updated.count) return reply.code(409).send({ error: 'schedule_not_cancellable' });
    return { status: 'CANCELLED' };
  });

  app.post('/api/admin/events/:id/communications/:batchId/retry', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = retrySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id, batchId } = req.params as { id: string; batchId: string };
    const summary = await retryFailedDeliveries({ prisma: deps.prisma, mailer: deps.mailer }, id, batchId, parsed.data.deliveryIds, new Date(), { includeAmbiguous: parsed.data.includeAmbiguous });
    if (summary.sent > 0 && summary.failed === 0 && summary.ambiguous === 0 && summary.pending === 0) {
      await deps.prisma.scheduledMessage.updateMany({
        where: { eventId: id, batchId, status: 'FAILED' },
        data: { status: 'COMPLETED', completedAt: new Date(), error: null },
      });
    }
    return summary;
  });

  app.get('/api/admin/events/:id/communications/deliveries', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    await reconcileStaleDeliveries(deps.prisma, new Date());
    const rows = await deps.prisma.emailLog.findMany({ where: { eventId: id }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => ({
      id: row.id, registrationId: row.registrationId, associationId: row.associationId,
      senderUserId: row.senderUserId, batchId: row.batchId, to: row.to, subject: row.subject,
      body: row.body, kind: row.kind, status: row.status, attempts: row.attempts,
      createdAt: row.createdAt.toISOString(), lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null, failedAt: row.failedAt?.toISOString() ?? null, error: row.error,
    }));
  });
}
