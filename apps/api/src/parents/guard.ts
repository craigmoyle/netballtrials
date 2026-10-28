import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { hashToken } from '../auth/tokens';
import { normalizeEmail } from '../auth/service';

export const PARENT_SESSION_COOKIE = 'nt_parent';

declare module 'fastify' {
  interface FastifyRequest {
    parentEmail?: string;
    parentSessionId?: string;
  }
}

export function requireParent(deps: AppDeps) {
  return async function parentGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies?.[PARENT_SESSION_COOKIE];
    if (!token) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const session = await deps.prisma.parentAccessSession.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await deps.prisma.parentAccessSession.delete({ where: { id: session.id } }).catch(() => undefined);
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const email = normalizeEmail(session.email);
    const registration = await deps.prisma.registration.findFirst({
      where: {
        parentEmail: { equals: email, mode: 'insensitive' },
        parentEmailVerifiedAt: { not: null },
        anonymizedAt: null,
      },
      select: { id: true },
    });
    if (!registration) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    req.parentEmail = email;
    req.parentSessionId = session.id;
  };
}
