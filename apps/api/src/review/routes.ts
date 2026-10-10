import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { withdrawRegistration } from '../registrations/service';
import { sendConfirmation } from '../registrations/confirmation';
import { ensureReviewItems, listReviewQueue, resolveReviewItem } from './service';
import { EmailBatchConflictError, getDeliverySummary, reconcileStaleDeliveries, retryFailedDeliveries, sendEventMessage } from '../messages/service';

const resolveSchema = z.object({ note: z.string().max(2000).optional() });
const messageSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(5000),
  batchId: z.uuid(),
});
const retrySchema = z.object({
  deliveryIds: z.array(z.string().min(1).max(100)).min(1).max(500),
  includeAmbiguous: z.boolean().default(false),
});

export function registerReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/events/:id/review', { preHandler: requireAdmin(deps) }, async (req) => {
    const { id } = req.params as { id: string };
    await ensureReviewItems(deps.prisma, id);
    return listReviewQueue(deps.prisma, id);
  });

  app.post(
    '/api/admin/events/:id/review/:itemId/resolve',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const parsed = resolveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed' });
      }
      const { id, itemId } = req.params as { id: string; itemId: string };
      const resolved = await resolveReviewItem(
        deps.prisma,
        id,
        itemId,
        { resolvedByUserId: req.adminUserId ?? '', note: parsed.data.note ?? null },
        new Date(),
      );
      if (!resolved) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return resolved;
    },
  );

  app.post(
    '/api/admin/events/:id/registrations/:registrationId/withdraw',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const { id, registrationId } = req.params as { id: string; registrationId: string };
      const withdrawn = await withdrawRegistration(deps.prisma, id, registrationId, new Date());
      if (!withdrawn) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return {
        id: withdrawn.id,
        status: withdrawn.status,
        bibNumber: withdrawn.bibNumber,
        checkedInAt: withdrawn.checkedInAt,
      };
    },
  );

  app.post('/api/admin/events/:id/messages', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = messageSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    try {
      return await sendEventMessage(
        { prisma: deps.prisma, mailer: deps.mailer },
        id,
        { subject: parsed.data.subject, text: parsed.data.text },
        new Date(),
        { batchId: parsed.data.batchId, senderUserId: req.adminUserId },
      );
    } catch (error) {
      if (error instanceof EmailBatchConflictError) return reply.code(409).send({ error: 'idempotency_conflict' });
      throw error;
    }
  });

  app.post('/api/admin/events/:id/messages/:batchId/retry', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = retrySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id, batchId } = req.params as { id: string; batchId: string };
    const now = new Date();
    const pendingConfirmations = await deps.prisma.emailLog.findMany({
      where: {
        eventId: id,
        batchId,
        id: { in: parsed.data.deliveryIds },
        kind: 'confirmation',
        status: 'PENDING',
        messagePayload: { equals: Prisma.DbNull },
      },
      include: { registration: { include: { event: true } } },
    });
    for (const delivery of pendingConfirmations) {
      const registration = delivery.registration;
      if (!registration?.qrToken) continue;
      await sendConfirmation(
        { prisma: deps.prisma, mailer: deps.mailer },
        registration,
        registration.event,
        `${deps.env.WEB_ORIGIN}/ticket/${registration.qrToken}`,
        { batchId },
      );
    }

    const hydratedIds = new Set(pendingConfirmations.map((delivery) => delivery.id));
    const retryIds = parsed.data.deliveryIds.filter((deliveryId) => !hydratedIds.has(deliveryId));
    if (retryIds.length) {
      await retryFailedDeliveries(
        { prisma: deps.prisma, mailer: deps.mailer },
        id,
        batchId,
        retryIds,
        now,
        { includeAmbiguous: parsed.data.includeAmbiguous },
      );
    }
    return getDeliverySummary(deps.prisma, batchId);
  });

  app.get('/api/admin/events/:id/email-log', { preHandler: requireAdmin(deps) }, async (req) => {
    const { id } = req.params as { id: string };
    await reconcileStaleDeliveries(deps.prisma, new Date());
    const logs = await deps.prisma.emailLog.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'desc' },
    });
    return logs.map((log) => ({
      id: log.id,
      registrationId: log.registrationId,
      senderUserId: log.senderUserId,
      batchId: log.batchId,
      to: log.to,
      subject: log.subject,
      body: log.body,
      kind: log.kind,
      status: log.status,
      attempts: log.attempts,
      createdAt: log.createdAt.toISOString(),
      lastAttemptAt: log.lastAttemptAt?.toISOString() ?? null,
      sentAt: log.sentAt?.toISOString() ?? null,
      failedAt: log.failedAt ? log.failedAt.toISOString() : null,
      error: log.error,
    }));
  });
}
