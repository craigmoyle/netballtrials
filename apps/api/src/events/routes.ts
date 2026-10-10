import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { EventValidationError, type EventInput, type EventPatch } from './schemas';
import { DEFAULT_POLICY_URL } from '../policy';
import { createEvent, closeEvent, EventLifecycleError, getEvent, listEvents, openEvent, updateEvent } from './service';

const policyUploadSchema = z.object({
  fileName: z.string().trim().min(5).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*\.pdf$/i),
  pdfBase64: z.string().min(8),
});
const MAX_POLICY_BYTES = 700 * 1024;

function pdfFromPayload(value: string): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return null;
  return bytes;
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

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

  app.post('/api/admin/events/:id/open', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await openEvent(deps.prisma, id);
      if (!event) return reply.code(404).send({ error: 'not_found' });
      return event;
    } catch (error) {
      if (error instanceof EventLifecycleError) return reply.code(409).send({ error: 'invalid_transition' });
      throw error;
    }
  });

  app.post('/api/admin/events/:id/close', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await closeEvent(deps.prisma, id);
      if (!event) return reply.code(404).send({ error: 'not_found' });
      return event;
    } catch (error) {
      if (error instanceof EventLifecycleError) return reply.code(409).send({ error: 'invalid_transition' });
      throw error;
    }
  });

  app.put('/api/admin/events/:id/policy-document', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = policyUploadSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const parsedBytes = pdfFromPayload(parsed.data.pdfBase64);
    if (!parsedBytes) return reply.code(400).send({ error: 'invalid_pdf' });
    if (parsedBytes.length > MAX_POLICY_BYTES) return reply.code(413).send({ error: 'file_too_large' });
    const bytes = Uint8Array.from(parsedBytes);
    const { id } = req.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    const policyUrl = `${deps.env.API_PUBLIC_URL}/api/public/events/${id}/policy-document`;
    await deps.prisma.$transaction(async (tx) => {
      await tx.eventPolicyDocument.upsert({
        where: { eventId: id },
        create: { eventId: id, fileName: parsed.data.fileName, bytes },
        update: { fileName: parsed.data.fileName, bytes, uploadedAt: new Date() },
      });
      await tx.event.update({ where: { id }, data: { policyDocumentName: parsed.data.fileName, policyUrl } });
    });
    return { policyDocumentName: parsed.data.fileName, policyUrl };
  });

  app.delete('/api/admin/events/:id/policy-document', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    await deps.prisma.$transaction(async (tx) => {
      await tx.eventPolicyDocument.deleteMany({ where: { eventId: id } });
      await tx.event.update({ where: { id }, data: { policyDocumentName: null, policyUrl: DEFAULT_POLICY_URL } });
    });
    return reply.code(204).send();
  });

  app.get('/api/public/events/:id/policy-document', async (req, reply) => {
    const { id } = req.params as { id: string };
    const document = await deps.prisma.eventPolicyDocument.findUnique({ where: { eventId: id } });
    if (!document) return reply.code(404).send({ error: 'not_found' });
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${safeFilename(document.fileName)}"`)
      .send(Buffer.from(document.bytes));
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
