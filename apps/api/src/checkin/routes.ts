import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { createPinLimiter } from './limiter';
import { isValidPinFormat } from './pin';
import {
  CheckInClosedError,
  CheckInUnavailableError,
  PinInvalidError,
  PinLockedError,
  closeCheckIn,
  getCheckInSummary,
  lookupRegistrations,
  manualCheckIn,
  checkInByToken,
  openCheckInSession,
  resolveCheckInEvent,
  setCheckInPin,
  undoCheckIn,
} from './service';

const pinSchema = z.object({ pin: z.string() });
const pinLimiter = createPinLimiter({ max: 10, windowMs: 10 * 60_000 });

function nowFrom(request: FastifyRequest): Date {
  if (process.env.NODE_ENV === 'test') {
    const header = request.headers['x-test-now'];
    if (typeof header === 'string') {
      return new Date(header);
    }
  }
  return new Date();
}

function labelFrom(request: FastifyRequest): string {
  const label = request.headers['x-checkin-label'];
  return typeof label === 'string' && label ? label : 'Volunteer';
}

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

  app.post('/api/check-in/session', async (req, reply) => {
    const parsed = z
      .object({ eventId: z.string().min(1), pin: z.string() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    const now = nowFrom(req);
    const clientKey = req.ip ?? 'unknown';

    try {
      const session = await openCheckInSession(
        deps,
        { ...parsed.data, clientKey },
        now,
        pinLimiter,
      );

      reply.setCookie('nt_checkin', session.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: deps.env.SESSION_COOKIE_SECURE,
        maxAge: Math.max(60, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000)),
      });

      return reply.code(200).send({ eventName: session.eventName });
    } catch (err) {
      if (err instanceof PinInvalidError) {
        return reply.code(401).send({ error: 'pin_invalid' });
      }
      if (err instanceof PinLockedError) {
        return reply.code(429).send({ error: 'pin_locked' });
      }
      if (err instanceof CheckInClosedError) {
        return reply.code(409).send({ error: 'check_in_closed' });
      }
      if (err instanceof CheckInUnavailableError) {
        return reply.code(404).send({ error: 'not_found' });
      }
      throw err;
    }
  });

  app.get('/api/check-in/session', async (req, reply) => {
    const token = req.cookies?.nt_checkin;
    if (!token) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const summary = await getCheckInSummary(deps.prisma, token, nowFrom(req));
    if (!summary) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    return summary;
  });

  app.get('/api/check-in/lookup', async (req, reply) => {
    const eventId = await resolveCheckInEvent(deps.prisma, req.cookies?.nt_checkin, nowFrom(req));
    if (!eventId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const query = String((req.query as { q?: string }).q ?? '');
    return lookupRegistrations(deps.prisma, eventId, query);
  });

  app.post('/api/check-in/scan', async (req, reply) => {
    const eventId = await resolveCheckInEvent(deps.prisma, req.cookies?.nt_checkin, nowFrom(req));
    if (!eventId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }
    return checkInByToken(deps.prisma, eventId, parsed.data.token, labelFrom(req), nowFrom(req));
  });

  app.post('/api/check-in/registrations/:id', async (req, reply) => {
    const eventId = await resolveCheckInEvent(deps.prisma, req.cookies?.nt_checkin, nowFrom(req));
    if (!eventId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    return manualCheckIn(deps.prisma, eventId, id, labelFrom(req), nowFrom(req));
  });

  app.post('/api/check-in/registrations/:id/undo', async (req, reply) => {
    const eventId = await resolveCheckInEvent(deps.prisma, req.cookies?.nt_checkin, nowFrom(req));
    if (!eventId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = req.params as { id: string };
    const undone = await undoCheckIn(deps.prisma, eventId, id);
    if (!undone) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.code(204).send();
  });
}
