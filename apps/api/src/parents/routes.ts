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
  listParentRegistrations,
  requestParentAccessLink,
  requestParentEmailChange,
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

function parentError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ParentAccessError)) throw error;
  if (error.code === 'not_found') return reply.code(404).send({ error: 'not_found' });
  if (error.code === 'duplicate_player') return reply.code(409).send({ error: 'already_registered' });
  if (error.code === 'email_change_conflict') return reply.code(409).send({ error: 'email_change_unavailable' });
  if (error.code === 'checkout_unavailable') return reply.code(503).send({ error: 'checkout_unavailable' });
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
      return reply.send(await withdrawParentRegistration(deps.prisma, request.parentEmail!, id, new Date()));
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
      await requestParentEmailChange(deps, request.parentEmail!, parsed.data.email, new Date());
      return reply.code(202).send({ status: 'sent' });
    } catch {
      // Do not reveal whether the requested email is already used by another parent group.
      return reply.code(202).send({ status: 'sent' });
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

  app.get('/api/admin/events/:id/incomplete-registrations', { preHandler: requireAdmin(deps) }, async (request) => {
    const { id } = request.params as { id: string };
    return listIncompleteRegistrations(deps.prisma, id, new Date());
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
