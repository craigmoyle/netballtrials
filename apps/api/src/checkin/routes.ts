import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { isValidPinFormat } from './pin';
import { closeCheckIn, setCheckInPin } from './service';

const pinSchema = z.object({ pin: z.string() });

export function registerCheckInRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.put('/api/admin/events/:id/check-in-pin', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = pinSchema.safeParse(req.body ?? {});
    if (!parsed.success || !isValidPinFormat(parsed.data.pin)) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    const { id } = req.params as { id: string };
    const ok = await setCheckInPin(deps.prisma, id, parsed.data.pin, new Date());
    if (!ok) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(204).send();
  });

  app.delete('/api/admin/events/:id/check-in-pin', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await setCheckInPin(deps.prisma, id, null, new Date());
    if (!ok) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(204).send();
  });

  app.post('/api/admin/events/:id/check-in/close', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await closeCheckIn(deps.prisma, id, new Date());
    if (!ok) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(204).send();
  });
}
