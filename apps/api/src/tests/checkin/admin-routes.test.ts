import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
  eventId = (await prisma.event.create({ data: eventFixture() })).id;
});

describe('admin-scoped check-in sessions', () => {
  const nowHeader = { 'x-test-now': '2026-09-12T00:00:00.000Z' };

  it('lets an authenticated Admin check in a paid player without a configured event PIN', async () => {
    const registration = await prisma.registration.create({
      data: registrationFixture(eventId, {
        status: 'PAID', qrToken: 'admin-session-token-1234567890', checkedInAt: null, checkedInBy: null, bibNumber: null,
      }),
    });

    const opened = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`,
      cookies: { nt_session: cookie }, headers: nowHeader,
    });

    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json()).toEqual({ eventName: '15/U Ladies' });
    const checkInCookie = opened.cookies.find((item) => item.name === 'nt_checkin');
    expect(checkInCookie?.value).toBeTruthy();

    const summary = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: checkInCookie!.value }, headers: nowHeader });
    expect(summary.json()).toMatchObject({ eventId, registered: 1, checkedIn: 0 });
    const checked = await app.inject({
      method: 'POST', url: `/api/check-in/registrations/${registration.id}`,
      cookies: { nt_checkin: checkInCookie!.value }, headers: nowHeader,
    });
    expect(checked.statusCode).toBe(200);
    expect(checked.json()).toMatchObject({ result: 'checked_in', bibNumber: 1 });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkedInBy).toBe('Chisholm Admin');
  });

  it('keeps an Admin check-in session valid when the volunteer PIN changes', async () => {
    const registration = await prisma.registration.create({
      data: registrationFixture(eventId, { status: 'PAID', qrToken: 'pin-rotation-token-1234567890', checkedInAt: null, bibNumber: null }),
    });
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`, cookies: { nt_session: cookie }, headers: nowHeader });
    const checkInCookie = opened.cookies.find((item) => item.name === 'nt_checkin')!;
    await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: '482193' }, cookies: { nt_session: cookie } });

    const summary = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });
    const checked = await app.inject({ method: 'POST', url: `/api/check-in/registrations/${registration.id}`, cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });
    const checkedBy = (await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkedInBy;
    const undone = await app.inject({ method: 'POST', url: `/api/check-in/registrations/${registration.id}/undo`, cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });

    expect(summary.statusCode).toBe(200);
    expect(checked.json()).toMatchObject({ result: 'checked_in', bibNumber: 1 });
    expect(checkedBy).toBe('Chisholm Admin');
    expect(undone.statusCode).toBe(204);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkedInBy).toBeNull();
  });

  it('does not open an Admin check-in session without an Admin session', async () => {
    const response = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`, headers: nowHeader });
    expect(response.statusCode).toBe(401);
  });

  it('scopes an Admin check-in session to its event', async () => {
    const otherEventId = (await prisma.event.create({ data: eventFixture({ name: 'Other event' }) })).id;
    const registration = await prisma.registration.create({
      data: registrationFixture(otherEventId, { status: 'PAID', qrToken: 'other-event-token-1234567890', checkedInAt: null, bibNumber: null }),
    });
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`, cookies: { nt_session: cookie }, headers: nowHeader });
    expect(opened.statusCode).toBe(200);
    const checkInCookie = opened.cookies.find((item) => item.name === 'nt_checkin')!;
    const response = await app.inject({ method: 'POST', url: `/api/check-in/registrations/${registration.id}`, cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ result: 'refused', reason: 'unknown' });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkedInAt).toBeNull();
  });

  it('revokes an Admin check-in session when the Admin session is logged out', async () => {
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`, cookies: { nt_session: cookie }, headers: nowHeader });
    expect(opened.statusCode).toBe(200);
    const checkInCookie = opened.cookies.find((item) => item.name === 'nt_checkin')!;
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { nt_session: cookie } });
    const summary = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });

    expect(logout.statusCode).toBe(204);
    expect(summary.statusCode).toBe(401);
  });

  it('expires an Admin check-in session with its parent Admin session', async () => {
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`, cookies: { nt_session: cookie }, headers: nowHeader });
    expect(opened.statusCode).toBe(200);
    const checkInCookie = opened.cookies.find((item) => item.name === 'nt_checkin')!;
    const user = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date('2026-09-11T23:59:59.000Z') } });

    const summary = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });

    expect(summary.statusCode).toBe(401);
  });

  it('revokes an Admin check-in session when Admin check-in is closed', async () => {
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`, cookies: { nt_session: cookie }, headers: nowHeader });
    expect(opened.statusCode).toBe(200);
    const checkInCookie = opened.cookies.find((item) => item.name === 'nt_checkin')!;
    await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/close`, cookies: { nt_session: cookie } });
    const summary = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });

    expect(summary.statusCode).toBe(401);
  });
});

describe('admin check-in pin', () => {
  it('returns safe check-in settings for event controls without exposing the pin hash', async () => {
    const denied = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/check-in-settings` });
    expect(denied.statusCode).toBe(401);
    const initial = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/check-in-settings`, cookies: { nt_session: cookie } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ pinConfigured: false, checkInClosedAt: null });
    await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: '482193' }, cookies: { nt_session: cookie } });
    await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/close`, cookies: { nt_session: cookie } });
    const configured = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/check-in-settings`, cookies: { nt_session: cookie } });
    expect(configured.json()).toMatchObject({ pinConfigured: true });
    expect(configured.json().checkInClosedAt).toBeTruthy();
    expect(configured.json()).not.toHaveProperty('checkInPinHash');
  });

  it('sets and clears a pin, storing only a hash', async () => {
    const set = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: '482193' }, cookies: { nt_session: cookie } });
    expect(set.statusCode).toBe(204);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event?.checkInPinHash).toContain('scrypt$');
    expect(event?.checkInPinHash).not.toContain('482193');
    const clear = await app.inject({ method: 'DELETE', url: `/api/admin/events/${eventId}/check-in-pin`, cookies: { nt_session: cookie } });
    expect(clear.statusCode).toBe(204);
    expect((await prisma.event.findUnique({ where: { id: eventId } }))?.checkInPinHash).toBeNull();
  });
  it('rejects a badly formatted pin', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: 'abcd' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
  });
  it('rejects setting a new 4-digit pin', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: '4821' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
    expect((await prisma.event.findUnique({ where: { id: eventId } }))?.checkInPinHash).toBeNull();
  });
  it('closes check-in', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/close`, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(204);
    expect((await prisma.event.findUnique({ where: { id: eventId } }))?.checkInClosedAt).not.toBeNull();
  });
});
