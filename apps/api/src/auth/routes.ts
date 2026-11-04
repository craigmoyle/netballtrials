import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AdminLimitReachedError, consumeLoginToken, inviteAdmin, MAX_TEST_ADMINS, normalizeEmail, removeAdmin, requestLoginLink } from './service';
import { consumeRateLimit, rateLimitClientKey } from '../security/rate-limit';
import { hashToken, LOGIN_TOKEN_TTL_MINUTES } from './tokens';
import { requireAdmin } from './guard';

export const SESSION_COOKIE = 'nt_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const requestLinkSchema = z.object({
  email: z.string().trim().min(3).max(320),
});

const verifySchema = z.object({
  token: z.string().min(10).max(200),
});
const inviteSchema = z.object({ email: z.email().trim().max(320) });
const staffIdParamsSchema = z.object({ staffId: z.string().min(1).max(64) });
const LOGIN_LINK_LIMIT = 5;
const LOGIN_LINK_WINDOW_MS = 15 * 60_000;
const LOGIN_LINK_EMAIL_LIMIT = 3;
// Match the link lifetime: whenever an address is throttled, a link that caused it is still valid.
const LOGIN_LINK_EMAIL_WINDOW_MS = LOGIN_TOKEN_TTL_MINUTES * 60_000;

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/auth/request-link', async (req, reply) => {
    const parsed = requestLinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    const normalizedEmail = normalizeEmail(parsed.data.email);
    const key = createHash('sha256')
      .update(`login-link\\0${rateLimitClientKey(req.ip)}\\0${normalizedEmail}`)
      .digest('hex');
    const now = new Date();
    if (!(await consumeRateLimit(deps.prisma, key, now, LOGIN_LINK_LIMIT, LOGIN_LINK_WINDOW_MS))) {
      return reply.code(429).send({ error: 'try_again_later' });
    }
    // Per-email cap across all clients. Answer 202 either way so the response
    // never reveals whether the address is an admin or is being throttled.
    const emailKey = createHash('sha256').update(`login-link-email\0${normalizedEmail}`).digest('hex');
    if (!(await consumeRateLimit(deps.prisma, emailKey, now, LOGIN_LINK_EMAIL_LIMIT, LOGIN_LINK_EMAIL_WINDOW_MS))) {
      return reply.code(202).send({ status: 'sent' });
    }
    await requestLoginLink(
      { prisma: deps.prisma, mailer: deps.mailer, webOrigin: deps.env.WEB_ORIGIN },
      normalizedEmail,
      now,
    );
    return reply.code(202).send({ status: 'sent' });
  });

  app.post('/api/auth/verify', async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'link_invalid' });
    }

    const result = await consumeLoginToken(
      { prisma: deps.prisma },
      parsed.data.token,
      new Date(),
    );

    if (!result) {
      return reply.code(400).send({ error: 'link_invalid' });
    }
    reply.setCookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: deps.env.SESSION_COOKIE_SECURE,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return reply.code(200).send({ status: 'signed_in' });
  });

  app.get('/api/admin/staff', { preHandler: requireAdmin(deps) }, async (req) => {
    const hostedTestMode = deps.env.APP_ENV === 'testing' && deps.env.NODE_ENV === 'production';
    const admins = await deps.prisma.staffUser.findMany({
      orderBy: { email: 'asc' },
      select: { id: true, email: true, createdAt: true },
    });
    return {
      admins: admins.map((admin) => ({ ...admin, canRemove: admin.id !== req.adminUserId })),
      maxAdmins: hostedTestMode ? MAX_TEST_ADMINS : null,
    };
  });

  app.delete('/api/admin/staff/:staffId', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = staffIdParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const result = await removeAdmin(deps.prisma, parsed.data.staffId, req.adminUserId!);
    if (result === 'self') return reply.code(409).send({ error: 'cannot_remove_self' });
    if (result === 'actor_revoked') return reply.code(401).send({ error: 'unauthorized' });
    if (result === 'not_found') return reply.code(404).send({ error: 'admin_not_found' });
    return reply.code(204).send();
  });

  app.post('/api/admin/staff/invites', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = inviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const hostedTestMode = deps.env.APP_ENV === 'testing' && deps.env.NODE_ENV === 'production';
    try {
      await inviteAdmin(
        { prisma: deps.prisma, mailer: deps.mailer, webOrigin: deps.env.WEB_ORIGIN, ...(hostedTestMode ? { maxAdmins: MAX_TEST_ADMINS } : {}) },
        parsed.data.email,
        req.adminUserId!,
        new Date(),
      );
    } catch (error) {
      if (error instanceof AdminLimitReachedError) return reply.code(409).send({ error: 'admin_limit_reached' });
      throw error;
    }
    return reply.code(202).send({ status: 'sent' });
  });

  app.get('/api/auth/me', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const user = await deps.prisma.staffUser.findUnique({
      where: { id: req.adminUserId! },
    });

    if (!user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    return reply.code(200).send({
      user: { id: user.id, email: user.email, role: user.role },
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.nt_session;
    if (token) {
      await deps.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
