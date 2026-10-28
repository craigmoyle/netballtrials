import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { isCalendarDate } from '../validation/date';
import { searchPlayerHistory } from './service';

const searchSchema = z.object({
  playerName: z.string().trim().min(2).max(160),
  dateOfBirth: z.string().refine(isCalendarDate, 'must be a real YYYY-MM-DD date'),
});

export function registerPlayerHistoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/player-history', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const parsed = searchSchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    return searchPlayerHistory(deps.prisma, parsed.data.playerName, parsed.data.dateOfBirth, new Date());
  });
}
