import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { sendCheckoutContinuation } from './checkout';
import type { RegistrationInput } from './schemas';
import {
  createAdminPendingRegistration,
  RegistrationConflictError,
  RegistrationValidationError,
} from './service';

function nowFrom(request: FastifyRequest): Date {
  if (process.env.NODE_ENV === 'test') {
    const header = request.headers['x-test-now'];
    if (typeof header === 'string') return new Date(header);
  }
  return new Date();
}

function sendReceivedOrRetry(reply: FastifyReply, sent: boolean) {
  return sent
    ? reply.code(202).send({ status: 'received' })
    : reply.code(503).send({ error: 'checkout_unavailable' });
}

export function registerAdminRegistrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/admin/events/:id/day-of-registration', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const now = nowFrom(req);
    try {
      const registration = await createAdminPendingRegistration(
        deps.prisma,
        id,
        req.body as RegistrationInput,
        now,
      );
      return sendReceivedOrRetry(reply, await sendCheckoutContinuation(deps, registration, now));
    } catch (error) {
      if (error instanceof RegistrationValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
      }
      if (error instanceof RegistrationConflictError) {
        if (error.reason === 'closed') return reply.code(409).send({ error: 'event_unavailable' });
        if (error.existing?.status === 'PAID') return reply.code(409).send({ error: 'already_registered' });
        if (error.existing?.status === 'PENDING') {
          return sendReceivedOrRetry(reply, await sendCheckoutContinuation(deps, error.existing, now));
        }
        return reply.code(409).send({ error: 'registration_conflict' });
      }
      throw error;
    }
  });
}
