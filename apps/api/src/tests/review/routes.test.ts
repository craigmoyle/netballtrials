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
      url: `/api/admin/events/${eventId}/needs-attention`,
      cookies: { nt_session: cookie },
    });
    expect(list.json()).toHaveLength(1);
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/needs-attention/${list.json()[0].id}/resolve`,
      payload: { reason: 'Checked with the family' },
      cookies: { nt_session: cookie },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().resolvedByUserId).toBeTruthy();
    const history = await app.inject({
      method: 'GET',
      url: `/api/admin/events/${eventId}/needs-attention?includeResolved=true`,
      cookies: { nt_session: cookie },
    });
    expect(history.json()).toHaveLength(1);
    expect(history.json()[0]).toMatchObject({ id: list.json()[0].id, resolvedAt: expect.any(String), note: 'Checked with the family' });
    const openQueue = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/needs-attention`, cookies: { nt_session: cookie } });
    expect(openQueue.json()).toEqual([]);
  });
  it('requires a short explicit reason to resolve an attention item', async () => {
    await seedPaidFlagged(eventId);
    const list = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/needs-attention`, cookies: { nt_session: cookie } });
    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/needs-attention/${list.json()[0].id}/resolve`,
      payload: { reason: '' }, cookies: { nt_session: cookie },
    });
    expect(response.statusCode).toBe(400);
    expect(await prisma.reviewItem.findUniqueOrThrow({ where: { id: list.json()[0].id } })).toMatchObject({ resolvedAt: null });
  });

  it('requires a reason and withdraws through roster history without clearing attendance or payment', async () => {
    const paidAt = new Date('2026-08-20T00:00:00.000Z');
    const checkedInAt = new Date('2026-09-12T00:00:00.000Z');
    const reg = await seedPaidFlagged(eventId);
    await prisma.registration.update({
      where: { id: reg.id },
      data: { checkedInAt, bibNumber: 3, paidAt, paymentIntentId: 'pi_review' },
    });
    await prisma.rosterSnapshot.create({ data: { eventId, revision: 1, data: { registrations: [] } } });

    const missingReason = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${reg.id}/withdraw`,
      cookies: { nt_session: cookie }, payload: {},
    });
    expect(missingReason.statusCode).toBe(400);

    const res = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${reg.id}/withdraw`,
      cookies: { nt_session: cookie },
      payload: { reason: 'Ineligible correction', note: 'Family confirmed the recorded date.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'WITHDRAWN', bibNumber: 3, checkedInAt: checkedInAt.toISOString(), planning: { gaps: [] } });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).toMatchObject({
      status: 'WITHDRAWN', bibNumber: 3, checkedInAt, paymentIntentId: 'pi_review', paidAt,
      removalReason: 'Ineligible correction', removalNote: 'Family confirmed the recorded date.',
    });
    expect(await prisma.rosterSnapshot.count({ where: { eventId } })).toBe(2);
    expect(await prisma.auditEvent.findFirst({ where: { registrationId: reg.id, action: 'REGISTRATION_REMOVED' } })).toBeTruthy();
  });
  it('requires an admin session', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/review` })).statusCode,
    ).toBe(401);
  });
});
