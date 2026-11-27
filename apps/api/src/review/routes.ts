import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { REMOVAL_REASONS, removeFromRoster, RosterMutationError } from '../roster/service';
import { reconcileRosterChanges } from '../planner/service';
import { requestNow } from '../http-time';
import { ensureReviewItems, listReviewQueue, resolveReviewItem } from './service';

const resolveSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const withdrawalSchema = z.object({
  reason: z.enum(REMOVAL_REASONS),
  note: z.string().trim().max(2000).optional(),
}).strict().refine((value) => value.reason !== 'Other' || Boolean(value.note), { path: ['note'] });
export function registerReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  const listNeedsAttention = async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ includeResolved: z.enum(['true', 'false']).optional() }).safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    await ensureReviewItems(deps.prisma, id);
    return listReviewQueue(deps.prisma, id, parsed.data.includeResolved === 'true');
  };
  app.get('/api/admin/events/:id/needs-attention', { preHandler: requireAdmin(deps) }, listNeedsAttention);
  app.get('/api/admin/events/:id/review', { preHandler: requireAdmin(deps) }, listNeedsAttention);

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
        { resolvedByUserId: req.adminUserId ?? '', note: parsed.data.reason },
        new Date(),
      );
      if (!resolved) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return resolved;
    },
  );

  app.post(
    '/api/admin/events/:id/needs-attention/:itemId/resolve',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const parsed = resolveSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', fields: ['reason'] });
      const { id, itemId } = req.params as { id: string; itemId: string };
      const resolved = await resolveReviewItem(deps.prisma, id, itemId, { resolvedByUserId: req.adminUserId!, note: parsed.data.reason }, new Date());
      return resolved ? resolved : reply.code(404).send({ error: 'not_found' });
    },
  );

  app.post(
    '/api/admin/events/:id/registrations/:registrationId/withdraw',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const parsed = withdrawalSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', fields: parsed.error.issues.map((issue) => String(issue.path[0])).filter(Boolean) });
      const { id, registrationId } = req.params as { id: string; registrationId: string };
      const now = requestNow(req);
      try {
        const pending = await deps.prisma.registration.findFirst({
          where: { id: registrationId, eventId: id, status: 'PENDING' },
          select: { checkoutSessionId: true },
        });
        if (pending?.checkoutSessionId && !(await deps.payment.expireCheckout(pending.checkoutSessionId))) {
          return reply.code(409).send({ error: 'checkout_in_progress' });
        }
        const withdrawn = await removeFromRoster(deps.prisma, id, registrationId, {
          reason: parsed.data.reason, note: parsed.data.note ?? null,
        }, req.adminUserId!, now);
        let planning: { draftPlanId: string | null; gaps: Array<{ code: string; message: string }> } = { draftPlanId: null, gaps: [] };
        try {
          const reconciled = await reconcileRosterChanges(deps.prisma, id, now, req.adminUserId);
          planning = reconciled.ok
            ? { draftPlanId: reconciled.plan?.id ?? null, gaps: [] }
            : { draftPlanId: null, gaps: reconciled.gaps };
        } catch {
          planning.gaps.push({ code: 'reconciliation_failed', message: 'The roster change was saved, but the future plan could not be reconciled. Retry planning before play continues.' });
        }
        return {
          id: withdrawn.id,
          status: withdrawn.status,
          bibNumber: withdrawn.bibNumber,
          checkedInAt: withdrawn.checkedInAt,
          planning,
        };
      } catch (error) {
        if (!(error instanceof RosterMutationError)) throw error;
        return reply.code(error.code === 'not_found' ? 404 : 409).send({ error: error.code });
      }
    },
  );

}
