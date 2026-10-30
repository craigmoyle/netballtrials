import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { POSITIONS } from '@netball-trials/types';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { requireParent, PARENT_SESSION_COOKIE } from './guard';
import {
  ParentAccessError,
  PARENT_SESSION_TTL_HOURS,
  confirmParentEmailChange,
  consumeParentAccessToken,
  continueParentCheckout,
  expireParentAccessSession,
  listIncompleteRegistrations,
  listRegistrationChanges,
  listParentRegistrations,
  requestParentAccessLink,
  requestParentEmailChange,
  requestIncompleteEmailCorrection,
  sendIncompleteRegistrationReminder,
  updateParentRegistration,
  withdrawParentRegistration,
} from './service';

const emailSchema = z.email().trim().max(320);
const tokenSchema = z.object({ token: z.string().min(10).max(200) });
const positionSchema = z.enum(POSITIONS);
const parentUpdateSchema = z.object({
  playerFirstName: z.string().trim().min(1).max(80).optional(),
  playerLastName: z.string().trim().min(1).max(80).optional(),
  parentName: z.string().trim().min(1).max(120).optional(),
  parentMobile: z.string().trim().regex(/^[0-9 +()-]{6,20}$/).optional(),
  rank1Position: positionSchema.optional(),
  rank2Position: positionSchema.nullable().optional(),
  rank3Position: positionSchema.nullable().optional(),
  optInExtraPositions: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);
const emailChangeSchema = z.object({ email: emailSchema });
const incompleteEmailCorrectionSchema = z.object({ email: emailSchema, familyConfirmed: z.literal(true) });

function parentError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ParentAccessError)) throw error;
  if (error.code === 'not_found') return reply.code(404).send({ error: 'not_found' });
  if (error.code === 'duplicate_player') return reply.code(409).send({ error: 'already_registered' });
  if (error.code === 'invalid_positions') return reply.code(400).send({ error: 'validation_failed', fields: ['rank2Position', 'rank3Position'] });
  if (error.code === 'email_change_conflict') return reply.code(409).send({ error: 'email_change_unavailable' });
  if (error.code === 'email_change_busy') return reply.code(409).send({ error: 'email_change_busy' });
  if (error.code === 'email_rate_limited') return reply.code(429).send({ error: 'try_again_later' });
  if (error.code === 'checkout_unavailable') return reply.code(503).send({ error: 'checkout_unavailable' });
  if (error.code === 'checkout_in_progress') return reply.code(409).send({ error: 'checkout_in_progress' });
  return reply.code(409).send({ error: 'registration_locked' });
}

export function registerParentAccessRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/public/parent-access/request-link', async (request, reply) => {
    const parsed = emailSchema.safeParse((request.body as { email?: unknown } | null)?.email);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    await requestParentAccessLink(deps, parsed.data, request.ip, new Date());
    return reply.code(202).send({ status: 'sent' });
  });

  app.post('/api/public/parent-access/verify', async (request, reply) => {
    const parsed = tokenSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'link_invalid' });
    const result = await consumeParentAccessToken(deps.prisma, parsed.data.token, new Date());
    if (!result) return reply.code(400).send({ error: 'link_invalid' });
    reply.setCookie(PARENT_SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: deps.env.SESSION_COOKIE_SECURE,
      maxAge: PARENT_SESSION_TTL_HOURS * 60 * 60,
    });
    return reply.code(200).send({ status: 'signed_in' });
  });

  app.get('/api/parent/registrations', { preHandler: requireParent(deps) }, async (request) => {
    return listParentRegistrations(deps.prisma, request.parentEmail!, new Date());
  });

  app.post('/api/parent/logout', { preHandler: requireParent(deps) }, async (request, reply) => {
    const token = request.cookies?.[PARENT_SESSION_COOKIE];
    if (token) await expireParentAccessSession(deps.prisma, token);
    reply.clearCookie(PARENT_SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.patch('/api/parent/registrations/:id', { preHandler: requireParent(deps) }, async (request, reply) => {
    const parsed = parentUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = request.params as { id: string };
    try {
      const registration = await updateParentRegistration(deps.prisma, request.parentEmail!, id, parsed.data, new Date());
      return reply.send(registration);
    } catch (error) {
      return parentError(reply, error);
    }
  });

  app.post('/api/parent/registrations/:id/withdraw', { preHandler: requireParent(deps) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await withdrawParentRegistration(deps, request.parentEmail!, id, new Date()));
    } catch (error) {
      return parentError(reply, error);
    }
  });

  app.post('/api/parent/registrations/:id/checkout', { preHandler: requireParent(deps) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await continueParentCheckout(deps, request.parentEmail!, id, new Date()));
    } catch (error) {
      return parentError(reply, error);
    }
  });

  app.post('/api/parent/email-change', { preHandler: requireParent(deps) }, async (request, reply) => {
    const parsed = emailChangeSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    try {
      const result = await requestParentEmailChange(deps, request.parentEmail!, parsed.data.email, new Date());
      if (result === 'rate_limited') return reply.code(429).send({ error: 'try_again_later' });
      if (result === 'unchanged') return reply.code(400).send({ error: 'same_email' });
      return reply.code(202).send({ status: 'sent' });
    } catch {
      deps.log?.warn({ code: 'parent_email_change_send_failed' }, 'parent_email_change_send_failed');
      return reply.code(503).send({ error: 'email_change_unavailable' });
    }
  });

  app.post('/api/parent/email-change/confirm', { preHandler: requireParent(deps) }, async (request, reply) => {
    const parsed = tokenSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'link_invalid' });
    try {
      const email = await confirmParentEmailChange(
        deps,
        request.parentEmail!,
        request.parentSessionId!,
        parsed.data.token,
        new Date(),
      );
      return reply.send({ status: 'email_updated', email });
    } catch (error) {
      return parentError(reply, error);
    }
  });

  app.get('/api/admin/events/:id/registrations/:registrationId/changes', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const { id, registrationId } = request.params as { id: string; registrationId: string };
    const changes = await listRegistrationChanges(deps.prisma, id, registrationId, new Date());
    if (!changes) return reply.code(404).send({ error: 'not_found' });
    return changes;
  });

  app.get('/api/admin/events/:id/incomplete-registrations', { preHandler: requireAdmin(deps) }, async (request) => {
    const { id } = request.params as { id: string };
    return listIncompleteRegistrations(deps.prisma, id, new Date());
  });

  app.post('/api/admin/events/:id/incomplete-registrations/:registrationId/email-correction', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const parsed = incompleteEmailCorrectionSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id, registrationId } = request.params as { id: string; registrationId: string };
    try {
      await requestIncompleteEmailCorrection(deps, id, registrationId, parsed.data.email, new Date());
      return reply.code(202).send({ status: 'sent' });
    } catch (error) {
      if (error instanceof ParentAccessError) return parentError(reply, error);
      deps.log?.warn({ code: 'registration_email_correction_send_failed' }, 'registration_email_correction_send_failed');
      return reply.code(503).send({ error: 'email_verification_unavailable' });
    }
  });

  app.post('/api/admin/events/:id/incomplete-registrations/:registrationId/reminder', { preHandler: requireAdmin(deps) }, async (request, reply) => {
    const { id, registrationId } = request.params as { id: string; registrationId: string };
    try {
      await sendIncompleteRegistrationReminder(deps, id, registrationId, request.adminUserId!, new Date());
      return reply.send({ status: 'sent' });
    } catch (error) {
      return parentError(reply, error);
    }
  });
}
