import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { withdrawRegistration } from '../registrations/service';
import { ensureReviewItems, listReviewQueue, resolveReviewItem } from './service';

const resolveSchema = z.object({ note: z.string().max(2000).optional() });

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

  app.get('/api/admin/events/:id/email-log', { preHandler: requireAdmin(deps) }, async (req) => {
    const { id } = req.params as { id: string };
    const logs = await deps.prisma.emailLog.findMany({
      where: { eventId: id },
      orderBy: { sentAt: 'desc' },
    });
    return logs.map((log) => ({
      id: log.id,
      registrationId: log.registrationId,
      to: log.to,
      subject: log.subject,
      kind: log.kind,
      sentAt: log.sentAt.toISOString(),
      failedAt: log.failedAt ? log.failedAt.toISOString() : null,
      error: log.error,
    }));
  });
}
