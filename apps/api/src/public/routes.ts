import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { getPublicEvent } from './service';

export function registerPublicRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/public/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await getPublicEvent(deps.prisma, id);
    if (!event) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return event;
  });
}
