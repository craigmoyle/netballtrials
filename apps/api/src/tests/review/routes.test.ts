import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture } from '../helpers/fixtures';
import { seedPaidFlagged } from '../helpers/review';

const app = createApp();
let cookie: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
  eventId = (await prisma.event.create({ data: eventFixture() })).id;
});

describe('review routes', () => {
  it('lists and resolves flagged registrations', async () => {
    await seedPaidFlagged(eventId);
    const list = await app.inject({
      method: 'GET',
      url: `/api/admin/events/${eventId}/review`,
      cookies: { nt_session: cookie },
    });
    expect(list.json()).toHaveLength(1);
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/review/${list.json()[0].id}/resolve`,
      payload: { note: 'ok' },
      cookies: { nt_session: cookie },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().resolvedByUserId).toBeTruthy();
  });
  it('withdraws a registration and clears its check-in', async () => {
    const reg = await seedPaidFlagged(eventId);
    await prisma.registration.update({
      where: { id: reg.id },
      data: { checkedInAt: new Date(), bibNumber: 3 },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/registrations/${reg.id}/withdraw`,
      cookies: { nt_session: cookie },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.registration.findUnique({ where: { id: reg.id } });
    expect(after?.status).toBe('WITHDRAWN');
    expect(after?.bibNumber).toBeNull();
    expect(after?.checkedInAt).toBeNull();
  });
  it('requires an admin session', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/review` })).statusCode,
    ).toBe(401);
  });
});
