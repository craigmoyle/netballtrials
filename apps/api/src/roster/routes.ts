import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { isPastRetentionCutoff } from '../retention/service';
import { isCalendarDate } from '../validation/date';
import { correctRegistration, exportRosterCsv, getRoster, RosterCorrectionError } from './service';

const correctionSchema = z.object({
  dateOfBirth: z.string().refine(isCalendarDate, 'must be a real YYYY-MM-DD date').optional(),
  memberAssociation: z.string().trim().min(1).max(80).optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export function registerRosterRoutes(app: FastifyInstance, deps: AppDeps): void {
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
      return await correctRegistration(deps.prisma, id, registrationId, parsed.data, new Date());
    } catch (error) {
      if (!(error instanceof RosterCorrectionError)) throw error;
      if (error.code === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (error.code === 'duplicate_player') return reply.code(409).send({ error: 'already_registered' });
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
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.csv);
  });
}
