import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { EventValidationError, type EventInput, type EventPatch } from './schemas';
import { createEvent, getEvent, listEvents, updateEvent } from './service';

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/events', { preHandler: requireAdmin(deps) }, async () => {
    return listEvents(deps.prisma);
  });

  app.post('/api/admin/events', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    try {
      const event = await createEvent(deps.prisma, req.body as EventInput);
      return reply.code(201).send(event);
    } catch (err) {
      if (err instanceof EventValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: err.fields });
      }
      throw err;
    }
  });

  app.get('/api/admin/events/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await getEvent(deps.prisma, id);
    if (!event) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return event;
  });

  app.patch('/api/admin/events/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await updateEvent(deps.prisma, id, req.body as EventPatch);
      if (!event) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return event;
    } catch (err) {
      if (err instanceof EventValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: err.fields });
      }
      throw err;
    }
  });
}
