import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createDevMailer } from '../../mail/dev-mailer';
import { newLoginToken, newSession } from '../../auth/tokens';
import { signInAsNewAdmin } from '../helpers/auth';

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
    expect(outbox.sent.map((message) => message.to)).toEqual(['craig@example.com']);
  });
  it('sends at most three links per email per link lifetime but still answers 202', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/request-link', payload: { email: 'Craig@Example.com' },
        remoteAddress: `198.51.100.${i + 1}`,
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([202, 202, 202, 202]);
    expect(outbox.sent).toHaveLength(3);
    expect(await prisma.loginToken.count()).toBe(3);
  });
  it('keeps an earlier link working after a newer request', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'craig@example.com' } });
    await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'craig@example.com' } });
    const first = new URLSearchParams(new URL(outbox.sent[0].text.match(/https?:\/\/\S+/)![0]).hash.slice(1)).get('token')!;
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: first } });
    expect(verified.statusCode).toBe(200);
  });
  it('rejects a request with no body field', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: {} });
    expect(res.statusCode).toBe(400);
  });
  it('signs a token, sets a cookie, and reports the admin', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'craig@example.com' } });
    const token = new URLSearchParams(new URL(outbox.sent[0].text.match(/https?:\/\/\S+/)![0]).hash.slice(1)).get('token')!;
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    expect(verified.statusCode).toBe(200);
    const cookie = verified.cookies.find((c) => c.name === 'nt_session')!;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { nt_session: cookie.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('craig@example.com');
  });
  it('lists current Admins and revokes another Admin without allowing self-removal', async () => {
    const cookie = await signInAsNewAdmin(app, 'owner@example.com');
    const owner = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    const other = await prisma.staffUser.create({ data: { email: 'other@example.com' } });
    const session = newSession(new Date());
    const loginToken = newLoginToken(new Date());
    await prisma.session.create({ data: { userId: other.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    await prisma.loginToken.create({ data: { userId: other.id, tokenHash: loginToken.tokenHash, expiresAt: loginToken.expiresAt } });

    const list = await app.inject({ method: 'GET', url: '/api/admin/staff', cookies: { nt_session: cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().maxAdmins).toBeNull();
    expect(list.json().admins).toHaveLength(3);
    expect(list.json().admins).toContainEqual(expect.objectContaining({ id: owner.id, email: 'owner@example.com', canRemove: false }));
    expect(list.json().admins).toContainEqual(expect.objectContaining({ id: other.id, email: 'other@example.com', canRemove: true }));

    const selfRemoval = await app.inject({ method: 'DELETE', url: `/api/admin/staff/${owner.id}`, cookies: { nt_session: cookie } });
    expect(selfRemoval.statusCode).toBe(409);
    const removal = await app.inject({ method: 'DELETE', url: `/api/admin/staff/${other.id}`, cookies: { nt_session: cookie } });
    expect(removal.statusCode).toBe(204);
    expect(await prisma.staffUser.findUnique({ where: { id: other.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { tokenHash: session.tokenHash } })).toBeNull();
    expect(await prisma.loginToken.findUnique({ where: { tokenHash: loginToken.tokenHash } })).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { nt_session: cookie } })).statusCode).toBe(200);
  });

  it('serializes simultaneous removals so the last two Admins cannot remove each other', async () => {
    await prisma.staffUser.delete({ where: { email: 'craig@example.com' } });
    const ownerCookie = await signInAsNewAdmin(app, 'owner@example.com');
    const otherCookie = await signInAsNewAdmin(app, 'other@example.com');
    const owner = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    const other = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'other@example.com' } });

    const results = await Promise.all([
      app.inject({ method: 'DELETE', url: `/api/admin/staff/${other.id}`, cookies: { nt_session: ownerCookie } }),
      app.inject({ method: 'DELETE', url: `/api/admin/staff/${owner.id}`, cookies: { nt_session: otherCookie } }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([204, 401]);
    expect(await prisma.staffUser.count()).toBe(1);
  });

  it('returns a clear error for an expired or reused link', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token: 'not-a-real-token' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('link_invalid');
  });
  it('invalidates the server session on logout', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/request-link', payload: { email: 'craig@example.com' } });
    const token = new URLSearchParams(new URL(outbox.sent[0].text.match(/https?:\/\/\S+/)![0]).hash.slice(1)).get('token')!;
    const verified = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { token } });
    const cookieValue = verified.cookies.find((c) => c.name === 'nt_session')!.value;
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { nt_session: cookieValue } });
    expect(out.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { nt_session: cookieValue } });
    expect(me.statusCode).toBe(401);
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
