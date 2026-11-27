import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { isPastRetentionCutoff } from '../retention/service';
import { isCalendarDate } from '../validation/date';
import { reconcileRosterChanges } from '../planner/service';
import { requestNow } from '../http-time';
import {
  correctRegistration, exportRosterCsv, getRoster, markRegistrationDuplicate,
  REMOVAL_REASONS, removeFromRoster, RosterCorrectionError, RosterMutationError,
} from './service';

const removalSchema = z.object({
  reason: z.enum(REMOVAL_REASONS),
  note: z.string().trim().max(2000).optional(),
}).strict().refine((value) => value.reason !== 'Other' || Boolean(value.note), { path: ['note'] });
const duplicateSchema = z.object({
  duplicateOfRegistrationId: z.string().min(1),
  reason: z.literal('Duplicate'),
  note: z.string().trim().max(2000).optional(),
}).strict();

async function expireRosterCheckout(deps: AppDeps, eventId: string, registrationId: string): Promise<boolean> {
  const registration = await deps.prisma.registration.findFirst({
    where: { id: registrationId, eventId, status: 'PENDING' },
    select: { checkoutSessionId: true },
  });
  return !registration?.checkoutSessionId || await deps.payment.expireCheckout(registration.checkoutSessionId);
}

async function planningAfterRosterChange(deps: AppDeps, eventId: string, actorUserId: string, now: Date) {
  try {
    const result = await reconcileRosterChanges(deps.prisma, eventId, now, actorUserId);
    return result.ok
      ? { draftPlanId: result.plan?.id ?? null, gaps: [] }
      : { draftPlanId: null, gaps: result.gaps };
  } catch {
    return {
      draftPlanId: null,
      gaps: [{ code: 'reconciliation_failed', message: 'The roster change was saved, but the future plan could not be reconciled. Retry planning before play continues.' }],
    };
  }
}

const correctionSchema = z.object({
  dateOfBirth: z.string().refine(isCalendarDate, 'must be a real YYYY-MM-DD date').optional(),
  memberAssociation: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(3).max(500),
}).strict().refine((value) => value.dateOfBirth !== undefined || value.memberAssociation !== undefined);

export function registerRosterRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/admin/events/:id/registrations/:registrationId/remove', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const parsed = removalSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({
      error: 'validation_failed', fields: parsed.error.issues.map((issue) => String(issue.path[0])).filter(Boolean),
    });
    const { id, registrationId } = request.params as { id: string; registrationId: string };
    try {
      const now = requestNow(request);
      if (!(await expireRosterCheckout(deps, id, registrationId))) return reply.code(409).send({ error: 'checkout_in_progress' });
      const removed = await removeFromRoster(deps.prisma, id, registrationId, {
        reason: parsed.data.reason, note: parsed.data.note ?? null,
      }, request.adminUserId!, now);
      return {
        id: removed.id, status: removed.status, removedAt: removed.removedAt,
        removalReason: removed.removalReason,
        planning: await planningAfterRosterChange(deps, id, request.adminUserId!, now),
      };
    } catch (error) {
      if (!(error instanceof RosterMutationError)) throw error;
      return reply.code(error.code === 'not_found' ? 404 : 409).send({ error: error.code });
    }
  });

  app.post('/api/admin/events/:id/registrations/:registrationId/duplicate', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const parsed = duplicateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id, registrationId } = request.params as { id: string; registrationId: string };
    try {
      const now = requestNow(request);
      if (!(await expireRosterCheckout(deps, id, registrationId))) return reply.code(409).send({ error: 'checkout_in_progress' });
      const duplicate = await markRegistrationDuplicate(deps.prisma, id, registrationId,
        parsed.data.duplicateOfRegistrationId, { note: parsed.data.note ?? null }, request.adminUserId!, now);
      return {
        id: duplicate.id, status: duplicate.status, removedAt: duplicate.removedAt,
        duplicateOfRegistrationId: duplicate.duplicateOfRegistrationId,
        planning: await planningAfterRosterChange(deps, id, request.adminUserId!, now),
      };
    } catch (error) {
      if (!(error instanceof RosterMutationError)) throw error;
      return reply.code(error.code === 'not_found' ? 404 : 409).send({ error: error.code });
    }
  });

  app.get('/api/admin/events/:id/roster', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const roster = await getRoster(deps.prisma, id);
    if (!roster) return reply.code(404).send({ error: 'not_found' });
    return roster;
  });

  app.patch('/api/admin/events/:id/registrations/:registrationId', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const parsed = correctionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'validation_failed',
        fields: parsed.error.issues.map((issue) => String(issue.path[0])).filter(Boolean),
      });
    }
    const { id, registrationId } = request.params as { id: string; registrationId: string };
    try {
      const { reason, ...patch } = parsed.data;
      return await correctRegistration(deps.prisma, id, registrationId, patch, new Date(), {
        actorUserId: request.adminUserId, reason,
      });
    } catch (error) {
      if (!(error instanceof RosterCorrectionError)) throw error;
      if (error.code === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (error.code === 'duplicate_player') return reply.code(409).send({ error: 'already_registered' });
      if (error.code === 'ineligible') return reply.code(422).send({ error: 'ineligible', ...error.policy });
      return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
    }
  });

  app.get('/api/admin/events/:id/roster/export', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id }, select: { id: true, eventDate: true } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    if (isPastRetentionCutoff(event.eventDate, new Date())) {
      return reply.code(410).send({ error: 'roster_retention_expired' });
    }
    const file = await exportRosterCsv(deps.prisma, id);
    if (!file) return reply.code(410).send({ error: 'roster_retention_expired' });
    await deps.prisma.auditEvent.create({ data: {
      eventId: id, actorType: 'ADMIN', actorUserId: request.adminUserId, action: 'ROSTER_EXPORTED',
      entityType: 'RosterExport', entityId: id, reason: 'Roster export requested',
      metadata: { exportType: 'roster_csv', filename: file.filename },
    } });
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.csv);
  });
}
