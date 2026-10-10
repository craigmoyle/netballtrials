import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';
import { signInAsNewAdmin } from '../helpers/auth';

const app = createApp();
let adminCookie: string;

beforeEach(async () => {
  await resetDb();
  adminCookie = await signInAsNewAdmin(app, 'admin@example.com');
});

describe('event lifecycle', () => {
  it('opens a draft event explicitly and makes it public', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const opened = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${event.id}/open`,
      cookies: { nt_session: adminCookie },
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().status).toBe('OPEN');
    expect((await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` })).statusCode).toBe(200);
  });

  it('closes an open event and removes it from public registration', async () => {
    const event = await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) });
    const closed = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${event.id}/close`,
      cookies: { nt_session: adminCookie },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe('CLOSED');
    expect((await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` })).statusCode).toBe(404);
  });

  it('does not allow a generic patch to change lifecycle status', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/events/${event.id}`,
      payload: { status: 'OPEN' },
      cookies: { nt_session: adminCookie },
    });
    expect(patched.statusCode).toBe(400);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('DRAFT');
  });

  it('requires admin authentication for lifecycle transitions', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const response = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/open` });
    expect(response.statusCode).toBe(401);
  });
});
