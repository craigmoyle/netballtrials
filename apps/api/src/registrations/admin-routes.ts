import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { createHash } from 'node:crypto';
import { requestNow } from '../http-time';
import { consumeRateLimit } from '../security/rate-limit';
import { sendCheckoutContinuation, sendRecoveredCheckoutContinuation } from './checkout';
import { sendRegistrationEmailVerification } from '../parents/service';
import type { RegistrationInput } from './schemas';
import { completeLateArrival, LateArrivalError } from '../checkin/service';
import { reconcileRosterChanges } from '../planner/service';
import {
  createAdminPendingRegistration,
  RegistrationConflictError,
  RegistrationIneligibleError,
  RegistrationValidationError,
} from './service';

function sendReceivedOrRetry(reply: FastifyReply, sent: boolean, nextStep: 'verify-email' | 'checkout') {
  if (!sent) return reply.code(503).send({ error: nextStep === 'verify-email' ? 'email_verification_unavailable' : 'checkout_unavailable' });
  return reply.code(202).send({ status: 'received', nextStep });
}

function publicApiOrigin(deps: AppDeps): string {
  const hostedTestMode = deps.env.APP_ENV === 'testing' && deps.env.NODE_ENV === 'production';
  return (hostedTestMode ? deps.env.WEB_ORIGIN : deps.env.API_PUBLIC_URL).replace(/\/$/, '');
}

export function registerAdminRegistrationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/admin/events/:id/registrations/:registrationId/late-arrival', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id, registrationId } = req.params as { id: string; registrationId: string };
    const now = requestNow(req);
    try {
      const arrival = await completeLateArrival(deps.prisma, id, registrationId, req.adminUserId!, now);
      let planning = { draftPlanId: null as string | null, gaps: [] as Array<{ code: string; message: string }> };
      try {
        const reconciled = await reconcileRosterChanges(deps.prisma, id, now, req.adminUserId);
        planning = reconciled.ok
          ? { draftPlanId: reconciled.plan?.id ?? null, gaps: [] }
          : { draftPlanId: null, gaps: reconciled.gaps };
      } catch {
        planning.gaps.push({ code: 'reconciliation_failed', message: 'Attendance was saved, but the future plan could not be reconciled. Retry planning before play continues.' });
      }
      return { ...arrival, planning };
    } catch (error) {
      if (!(error instanceof LateArrivalError)) throw error;
      if (error.code === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (error.code === 'ineligible') return reply.code(422).send({
        error: 'ineligible', competitionYear: error.competitionYear, minAge: error.minAge, maxAge: error.maxAge,
      });
      return reply.code(409).send({ error: error.code });
    }
  });

  app.post('/api/admin/events/:id/day-of-registration', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const now = requestNow(req);
    try {
      const registration = await createAdminPendingRegistration(
        deps.prisma,
        id,
        req.body as RegistrationInput,
        now,
        req.adminUserId,
        publicApiOrigin(deps),
      );
      const nextStep = registration.parentEmailVerifiedAt ? 'checkout' : 'verify-email';
      const sent = nextStep === 'checkout'
        ? await sendCheckoutContinuation(deps, registration, now)
        : await sendRegistrationEmailVerification(deps, registration, now);
      return sendReceivedOrRetry(reply, sent, nextStep);
    } catch (error) {
      if (error instanceof RegistrationValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
      }
      if (error instanceof RegistrationIneligibleError) {
        return reply.code(422).send({ error: 'ineligible', competitionYear: error.competitionYear, minAge: error.minAge, maxAge: error.maxAge });
      }
      if (error instanceof RegistrationConflictError) {
        if (error.reason === 'closed') return reply.code(409).send({ error: 'event_unavailable' });
        if (error.existing?.status === 'PAID') return reply.code(409).send({ error: 'already_registered' });
        if (error.existing && ['PENDING', 'EXPIRED', 'FAILED'].includes(error.existing.status)) {
          const followUpKey = createHash('sha256').update(`admin-day-of-follow-up\0${error.existing.id}`).digest('hex');
          if (!(await consumeRateLimit(deps.prisma, followUpKey, now, 3, 15 * 60_000))) {
            return reply.code(429).send({ error: 'try_again_later' });
          }
          const nextStep = error.existing.parentEmailVerifiedAt ? 'checkout' : 'verify-email';
          const sent = nextStep === 'checkout'
            ? error.existing.status === 'PENDING' && error.existing.expiresAt > now
              ? await sendCheckoutContinuation(deps, error.existing, now)
              : await sendRecoveredCheckoutContinuation(deps, error.existing.id, now)
            : await sendRegistrationEmailVerification(deps, error.existing, now);
          return sendReceivedOrRetry(reply, sent, nextStep);
        }
        return reply.code(409).send({ error: 'registration_conflict' });
      }
      throw error;
    }
  });
}
