import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createDevMailer } from '../../mail/dev-mailer';

const app = createApp();
const outbox = app.testDeps.mailer as ReturnType<typeof createDevMailer>;

beforeEach(async () => {
  await resetDb();
  outbox.sent.length = 0;
  await prisma.staffUser.create({ data: { email: 'craig@example.com' } });
});

describe('auth routes', () => {
  it('always answers 202 to request-link', async () => {
    const known = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'craig@example.com' } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'nobody@example.com' } });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
  });
  it('rejects a request with no body field', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: {} });
    expect(res.statusCode).toBe(400);
  });
  it('signs a token, sets a cookie, and reports the admin', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'craig@example.com' } });
    const token = new URL(outbox.sent[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    expect(verified.statusCode).toBe(200);
    const cookie = verified.cookies.find((c) => c.name === 'nt_session')!;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { nt_session: cookie.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('craig@example.com');
  });
  it('returns a clear error for an expired or reused link', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: 'not-a-real-token' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('link_invalid');
  });
  it('returns 401 for a session whose admin was deleted', async () => {
    const user = await prisma.staffUser.create({ data: { email: 'gone@example.com' } });
    const { newSession, hashToken } = await import('../../auth/tokens');
    const { token } = newSession(new Date());
    await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.staffUser.delete({ where: { id: user.id } });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { nt_session: token } });
    expect(me.statusCode).toBe(401);
  });
});
