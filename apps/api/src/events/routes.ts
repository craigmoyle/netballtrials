import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { EventValidationError, type AnnualCloneInput, type EventInput, type EventPatch } from './schemas';
import { DEFAULT_POLICY_URL } from '../policy';
import { requestNow } from '../http-time';
import { cloneAnnualEvent, createEvent, closeEvent, deleteEvent, EventLifecycleError, getEvent, listEvents, openEvent, updateEvent } from './service';

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

function publicApiOrigin(deps: AppDeps): string {
  const hostedTestMode = deps.env.APP_ENV === 'testing' && deps.env.NODE_ENV === 'production';
  return (hostedTestMode ? deps.env.WEB_ORIGIN : deps.env.API_PUBLIC_URL).replace(/\/$/, '');
}

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/admin/events', { preHandler: requireAdmin(deps) }, async () => {
    return listEvents(deps.prisma);
  });

  app.post('/api/admin/events', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    try {
      const event = await createEvent(deps.prisma, req.body as EventInput, { actorUserId: req.adminUserId, now: requestNow(req) });
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
      const body = (req.body ?? {}) as { registrationClosesAt?: string; confirmReopen?: boolean };
      const event = await openEvent(deps.prisma, id, {
        ...body,
        actorUserId: req.adminUserId,
        now: requestNow(req),
        policySnapshotBaseUrl: publicApiOrigin(deps),
      });
      if (!event) return reply.code(404).send({ error: 'not_found' });
      return event;
    } catch (error) {
      if (error instanceof EventLifecycleError) return reply.code(409).send({ error: error.code });
      if (error instanceof EventValidationError) return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
      throw error;
    }
  });

  app.post('/api/admin/events/:id/close', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await closeEvent(deps.prisma, id, { actorUserId: req.adminUserId, now: requestNow(req) });
      if (!event) return reply.code(404).send({ error: 'not_found' });
      return event;
    } catch (error) {
      if (error instanceof EventLifecycleError) return reply.code(409).send({ error: 'invalid_transition' });
      throw error;
    }
  });

  app.post('/api/admin/events/:id/clone', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await cloneAnnualEvent(deps.prisma, id, (req.body ?? {}) as AnnualCloneInput, {
        actorUserId: req.adminUserId,
        now: requestNow(req),
        policyDocumentBaseUrl: publicApiOrigin(deps),
      });
      if (!event) return reply.code(404).send({ error: 'not_found' });
      return reply.code(201).send(event);
    } catch (error) {
      if (error instanceof EventValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
      }
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
    const policyUrl = `${publicApiOrigin(deps)}/api/public/events/${id}/policy-document`;
    const stored = await deps.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
      const event = await tx.event.findUnique({ where: { id } });
      if (!event) return 'not_found' as const;
      if (event.status === 'OPEN' || await tx.eventPolicySnapshot.count({ where: { eventId: id } }) > 0) return 'locked' as const;
      await tx.eventPolicyDocument.upsert({
        where: { eventId: id },
        create: { eventId: id, fileName: parsed.data.fileName, bytes },
        update: { fileName: parsed.data.fileName, bytes, uploadedAt: new Date() },
      });
      await tx.event.update({ where: { id }, data: { policyDocumentName: parsed.data.fileName, policyUrl } });
      await tx.auditEvent.create({ data: {
        eventId: id, actorType: 'ADMIN', actorUserId: req.adminUserId,
        action: 'POLICY_DOCUMENT_CHANGED', entityType: 'EventPolicyDocument', entityId: id,
        reason: 'Selection policy document changed',
        beforeState: { policyDocumentName: event.policyDocumentName }, afterState: { policyDocumentName: parsed.data.fileName },
      } });
      return 'stored' as const;
    });
    if (stored === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (stored === 'locked') return reply.code(409).send({ error: 'policy_locked' });
    return { policyDocumentName: parsed.data.fileName, policyUrl };
  });

  app.delete('/api/admin/events/:id/policy-document', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = await deps.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
      const event = await tx.event.findUnique({ where: { id } });
      if (!event) return 'not_found' as const;
      if (event.status === 'OPEN' || await tx.eventPolicySnapshot.count({ where: { eventId: id } }) > 0) return 'locked' as const;
      await tx.eventPolicyDocument.deleteMany({ where: { eventId: id } });
      await tx.event.update({ where: { id }, data: { policyDocumentName: null, policyUrl: DEFAULT_POLICY_URL } });
      await tx.auditEvent.create({ data: {
        eventId: id, actorType: 'ADMIN', actorUserId: req.adminUserId,
        action: 'POLICY_DOCUMENT_REMOVED', entityType: 'EventPolicyDocument', entityId: id,
        reason: 'Selection policy document removed', beforeState: { policyDocumentName: event.policyDocumentName },
        afterState: { policyDocumentName: null },
      } });
      return 'removed' as const;
    });
    if (removed === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (removed === 'locked') return reply.code(409).send({ error: 'policy_locked' });
    return reply.code(204).send();
  });

  app.get('/api/public/events/:id/policy-document', async (req, reply) => {
    const { id } = req.params as { id: string };
    const document = await deps.prisma.eventPolicyDocument.findUnique({ where: { eventId: id }, include: { event: { select: { status: true } } } });
    if (!document || document.event.status === 'DRAFT') return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('cache-control', 'public, max-age=300')
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${safeFilename(document.fileName)}"`)
      .send(Buffer.from(document.bytes));
  });

  app.get('/api/public/events/:id/policy-snapshots/:version', async (req, reply) => {
    const { id, version: rawVersion } = req.params as { id: string; version: string };
    const version = Number(rawVersion);
    if (!Number.isSafeInteger(version) || version < 1) return reply.code(404).send({ error: 'not_found' });
    const snapshot = await deps.prisma.eventPolicySnapshot.findFirst({
      where: { eventId: id, version, event: { status: { not: 'DRAFT' } } },
    });
    if (!snapshot) return reply.code(404).send({ error: 'not_found' });
    if (!snapshot.policyDocumentBytes) {
      return reply
        .header('cache-control', 'public, max-age=31536000, immutable')
        .redirect(snapshot.policyUrl ?? DEFAULT_POLICY_URL);
    }
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    if (snapshot.policyDocumentHash) reply.header('etag', `"${snapshot.policyDocumentHash}"`);
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="${safeFilename(snapshot.policyDocumentName ?? `policy-v${version}.pdf`)}"`)
      .send(Buffer.from(snapshot.policyDocumentBytes));
  });

  app.patch('/api/admin/events/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const event = await updateEvent(deps.prisma, id, req.body as EventPatch, { actorUserId: req.adminUserId, now: requestNow(req) });
      if (!event) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return event;
    } catch (err) {
      if (err instanceof EventLifecycleError) return reply.code(409).send({ error: err.code });
      if (err instanceof EventValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: err.fields });
      }
      throw err;
    }
  });

  app.delete('/api/admin/events/:id', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await deleteEvent(deps.prisma, id);
    if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
    if (result === 'has_registrations') return reply.code(409).send({ error: 'event_has_registrations' });
    if (result === 'has_communications') return reply.code(409).send({ error: 'event_has_communications' });
    return reply.code(204).send();
  });
}
