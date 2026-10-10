import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { isPastRetentionCutoff } from '../retention/service';
import { exportRosterCsv, getRoster } from './service';

export function registerRosterRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/events/:id/roster', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const roster = await getRoster(deps.prisma, id);
    if (!roster) return reply.code(404).send({ error: 'not_found' });
    return roster;
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
