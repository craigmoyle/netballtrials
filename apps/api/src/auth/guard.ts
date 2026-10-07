import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { hashToken } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    adminUserId?: string;
  }
}

export function requireAdmin(deps: AppDeps) {
  return async function adminGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies?.nt_session;
    if (!token) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const session = await deps.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) {
        await deps.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      }
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    const user = await deps.prisma.staffUser.findUnique({ where: { id: session.userId } });
    if (!user) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }

    req.adminUserId = user.id;
  };
}
