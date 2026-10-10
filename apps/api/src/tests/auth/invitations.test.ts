import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createDevMailer } from '../../mail/dev-mailer';
import { prisma } from '../../db';
import { bootstrapFirstAdmin } from '../../auth/service';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';

const mailer = createDevMailer([]);
const app = createApp({ mailer });
const loginDeps = { prisma, mailer, webOrigin: app.testDeps.env.WEB_ORIGIN };

beforeEach(async () => {
  await resetDb();
  mailer.sent.length = 0;
});

describe('first-admin bootstrap', () => {
  it('creates and emails the first admin, then refuses another identity', async () => {
    await bootstrapFirstAdmin(loginDeps, 'first@example.com', new Date('2026-10-10T00:00:00Z'));
    expect(await prisma.staffUser.count()).toBe(1);
    expect(mailer.sent[0].to).toBe('first@example.com');
    await expect(bootstrapFirstAdmin(loginDeps, 'attacker@example.com', new Date()))
      .rejects.toThrow(/bootstrap already used/i);
    expect(await prisma.staffUser.count()).toBe(1);
  });

  it('allows concurrent bootstrap attempts to create only one first admin', async () => {
    const results = await Promise.allSettled([
      bootstrapFirstAdmin(loginDeps, 'first@example.com', new Date()),
      bootstrapFirstAdmin(loginDeps, 'second@example.com', new Date()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.staffUser.count()).toBe(1);
  });
});

describe('admin invitations', () => {
  it('records the inviting admin and emails the new admin a one-time link', async () => {
    const cookie = await signInAsNewAdmin(app, 'owner@example.com');
    const owner = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/staff/invites',
      payload: { email: 'new-admin@example.com' },
      cookies: { nt_session: cookie },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'sent' });
    const invited = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'new-admin@example.com' } });
    expect(invited.invitedByUserId).toBe(owner.id);
    expect(mailer.sent.at(-1)?.to).toBe('new-admin@example.com');
    expect(mailer.sent.at(-1)?.text).toContain('/admin/verify?token=');
  });

  it('requires an admin session to invite another administrator', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/staff/invites',
      payload: { email: 'new-admin@example.com' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rate limits login-link requests without revealing whether an email exists', async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: 'unknown@example.com' },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ status: 'sent' });
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/request-link',
      payload: { email: 'unknown@example.com' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'try_again_later' });
  });
});
