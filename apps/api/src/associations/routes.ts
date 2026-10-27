import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { createAssociation, listActiveAssociations, listAssociations, updateAssociation } from './service';

const contactFields = {
  primaryContactName: z.string().trim().min(1).max(120).nullable().optional(),
  primaryContactEmail: z.email().trim().max(320).nullable().optional(),
};

function contactPairIsValid(data: { primaryContactName?: string | null; primaryContactEmail?: string | null }, context: z.RefinementCtx) {
  const hasName = Boolean(data.primaryContactName?.trim());
  const hasEmail = Boolean(data.primaryContactEmail?.trim());
  if (hasName !== hasEmail) {
    context.addIssue({ code: 'custom', path: [hasName ? 'primaryContactEmail' : 'primaryContactName'], message: 'Primary contact name and email must be provided together.' });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ...contactFields,
}).superRefine(contactPairIsValid);

const patchSchema = z.object({
  active: z.boolean().optional(),
  ...contactFields,
}).superRefine(contactPairIsValid);

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}

export function registerAssociationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/public/associations', async () => listActiveAssociations(deps.prisma));

  app.get('/api/admin/associations', { preHandler: requireAdmin(deps) }, async () => {
    return listAssociations(deps.prisma);
  });

  app.post('/api/admin/associations', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    try {
      const created = await createAssociation(deps.prisma, parsed.data);
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
    const updated = await updateAssociation(deps.prisma, id, parsed.data);
    if (!updated) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return updated;
  });
}
