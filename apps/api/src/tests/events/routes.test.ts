import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { registrationFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

const payload = { name: '17/U', competitionYear: 2027, division: '17/U', section: 'Ladies', eventDate: '2026-09-12', venue: 'SNC', startTime: '08:30', endTime: '12:00', firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 4, rank1Min: 2, rank2Min: 1, rank3Min: 1, minAge: 14, maxAge: 17 };

describe('event admin routes', () => {
  it('requires an admin session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/events/event-1' })).statusCode).toBe(401);
  });
  it('creates and lists an event for an admin', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: 'GET', url: '/api/admin/events', cookies: { nt_session: cookie } });
    expect(listed.json()).toHaveLength(1);
  });
  it('deletes an empty event regardless of status and returns 404 after deletion', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/open`, cookies: { nt_session: cookie } });
    expect(opened.statusCode).toBe(200);
    const white = await prisma.bibColor.findUniqueOrThrow({ where: { name: 'White' } });
    const black = await prisma.bibColor.findUniqueOrThrow({ where: { name: 'Black' } });
    await prisma.eventCourtColor.create({ data: { eventId, court: 1, teamAColorId: white.id, teamBColorId: black.id } });
    await prisma.eventPolicyDocument.create({ data: { eventId, fileName: 'policy.pdf', bytes: Buffer.from('%PDF-1.4') } });

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie } });
    expect(removed.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie } })).statusCode).toBe(404);
    expect(await prisma.eventCourtColor.count({ where: { eventId } })).toBe(0);
    expect(await prisma.eventPolicyDocument.findUnique({ where: { eventId } })).toBeNull();
  });

  it('blocks event deletion while any registration record remains', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    const eventId = created.json().id as string;
    const registration = await prisma.registration.create({
      data: registrationFixture(eventId, { status: 'WITHDRAWN', bibNumber: null, checkedInAt: null, qrToken: null }),
    });

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie } });

    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toEqual({ error: 'event_has_registrations' });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie } })).statusCode).toBe(200);
    expect(await prisma.registration.findUnique({ where: { id: registration.id } })).not.toBeNull();
  });

  it('returns 400 with field errors for a reversed window', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/events', payload: { ...payload, lastWhistle: '08:45' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
    expect(res.json().fields).toContain('lastWhistle');
  });
});
