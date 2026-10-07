import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../app';

type Outbox = { sent: { to: string; subject: string; text: string }[] };

export async function signInAsNewAdmin(app: FastifyInstance, email: string): Promise<string> {
  const deps: AppDeps = app.testDeps;
  const outbox = deps.mailer as unknown as Outbox;
  outbox.sent.length = 0;

  await deps.prisma.staffUser.create({ data: { email } });
  await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email } });

  const link = outbox.sent[0]?.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) {
    throw new Error('signInAsNewAdmin: no login link was emailed');
  }

  const token = new URL(link).searchParams.get('token')!;
  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/verify',
    payload: { token },
  });

  const cookie = verified.cookies.find((c) => c.name === 'nt_session');
  if (verified.statusCode !== 200 || !cookie) {
    throw new Error(`signInAsNewAdmin: verify failed with ${verified.statusCode}`);
  }

  return cookie.value;
}
