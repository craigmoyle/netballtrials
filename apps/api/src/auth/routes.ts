import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { consumeLoginToken, requestLoginLink } from './service';
import { requireAdmin } from './guard';

export const SESSION_COOKIE = 'nt_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const requestLinkSchema = z.object({
  email: z.string().trim().min(3).max(320),
});

const verifySchema = z.object({
  token: z.string().min(10).max(200),
});

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/auth/request-link', async (req, reply) => {
    const parsed = requestLinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed' });
    }

    await requestLoginLink(
      { prisma: deps.prisma, mailer: deps.mailer, webOrigin: deps.env.WEB_ORIGIN },
      parsed.data.email,
      new Date(),
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

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
