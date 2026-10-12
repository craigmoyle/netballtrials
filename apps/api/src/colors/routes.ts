import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import {
  archiveBibColor,
  BibColorArchivedError,
  BibColorNotFoundError,
  BibColorValidationError,
  createBibColor,
  getEventCourtColors,
  listBibColors,
  setEventCourtColors,
  updateBibColor,
} from './service';

const colorFields = {
  name: z.string().trim().min(1).max(60),
  hex: z.string().regex(/^#[\da-fA-F]{6}$/),
};
const createColorSchema = z.object(colorFields).strict();
const updateColorSchema = z.object({ name: colorFields.name.optional(), hex: colorFields.hex.optional() })
  .strict()
  .refine((input) => Object.keys(input).length > 0);
const courtColorsSchema = z.object({ teamAColorId: z.string().min(1), teamBColorId: z.string().min(1) }).strict();

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export function registerBibColorRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/bib-colors', { preHandler: requireAdmin(deps) }, async () => listBibColors(deps.prisma));

  app.post('/api/admin/bib-colors', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = createColorSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    try {
      return reply.code(201).send(await createBibColor(deps.prisma, parsed.data));
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send({ error: 'duplicate_color' });
      throw error;
    }
  });

  app.patch('/api/admin/bib-colors/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = updateColorSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    try {
      const updated = await updateBibColor(deps.prisma, id, parsed.data);
      return updated ? reply.code(200).send(updated) : reply.code(404).send({ error: 'not_found' });
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send({ error: 'duplicate_color' });
      throw error;
    }
  });

  app.delete('/api/admin/bib-colors/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await archiveBibColor(deps.prisma, id))) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.get('/api/admin/events/:id/court-colors', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const colors = await getEventCourtColors(deps.prisma, id);
    if (!colors) return reply.code(404).send({ error: 'not_found' });
    return colors;
  });

  app.put('/api/admin/events/:id/court-colors/:court', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id, court: courtParam } = req.params as { id: string; court: string };
    const parsedCourt = z.coerce.number().int().min(1).safeParse(courtParam);
    const parsedPair = courtColorsSchema.safeParse(req.body ?? {});
    if (!parsedCourt.success || !parsedPair.success) return reply.code(400).send({ error: 'validation_failed' });
    try {
      const saved = await setEventCourtColors(deps.prisma, id, parsedCourt.data, parsedPair.data);
      if (!saved) return reply.code(404).send({ error: 'not_found' });
      return reply.code(200).send(saved);
    } catch (error) {
      if (error instanceof BibColorValidationError) return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
      if (error instanceof BibColorArchivedError) return reply.code(409).send({ error: 'archived_color' });
      if (error instanceof BibColorNotFoundError) return reply.code(404).send({ error: 'not_found' });
      throw error;
    }
  });
}
