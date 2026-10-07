import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { createAssociation, listAssociations, setAssociationActive } from './service';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const patchSchema = z.object({
  active: z.boolean(),
});

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

export function registerAssociationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/associations', { preHandler: requireAdmin(deps) }, async () => {
    return listAssociations(deps.prisma);
  });

  app.post('/api/admin/associations', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    try {
      const created = await createAssociation(deps.prisma, parsed.data.name);
      return reply.code(201).send(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'duplicate' });
      }
      throw err;
    }
  });

  app.patch('/api/admin/associations/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    const { id } = req.params as { id: string };
    const updated = await setAssociationActive(deps.prisma, id, parsed.data.active);
    if (!updated) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return updated;
  });
}
