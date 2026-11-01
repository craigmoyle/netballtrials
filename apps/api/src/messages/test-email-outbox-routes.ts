import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';

export function registerTestEmailOutboxRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/test-email-outbox', { preHandler: requireAdmin(deps) }, async (_request, reply) => {
    if (!deps.env.ENABLE_TEST_INTEGRATIONS) return reply.code(404).send({ error: 'not_found' });
    const now = new Date();
    await deps.prisma.testEmailOutbox.deleteMany({ where: { expiresAt: { lte: now } } });
    const messages = await deps.prisma.testEmailOutbox.findMany({
      where: { expiresAt: { gt: now } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return messages.map(({ id, to, subject, body, createdAt, expiresAt }) => ({
      id, to, subject, body, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
    }));
  });

  app.delete('/api/admin/test-email-outbox', { preHandler: requireAdmin(deps) }, async (_request, reply) => {
    if (!deps.env.ENABLE_TEST_INTEGRATIONS) return reply.code(404).send({ error: 'not_found' });
    await deps.prisma.testEmailOutbox.deleteMany();
    return reply.code(204).send();
  });
}
