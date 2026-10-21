import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { registrationFixture } from '../helpers/fixtures';
import { DEFAULT_POLICY_URL } from '../../policy';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

const payload = { name: '17/U', competitionYear: 2027, division: '17/U', section: 'Ladies', eventDate: '2026-09-12', venue: 'SNC', startTime: '08:30', endTime: '12:00', gameStartTime: '09:00', registrationFeeCents: 3500, courts: 4, rank1Min: 2, rank2Min: 1, rank3Min: 1, minAge: 14, maxAge: 17 };

describe('event admin routes', () => {
  it('requires an admin session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/events/event-1' })).statusCode).toBe(401);
  });
  it('creates and lists an event with distinct arrival and game start times', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ startTime: '08:30', gameStartTime: '09:00' });
    expect(created.json()).not.toHaveProperty('lastWhistle');
    const listed = await app.inject({ method: 'GET', url: '/api/admin/events', cookies: { nt_session: cookie } });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ startTime: '08:30', gameStartTime: '09:00' });
  });
  it('preserves non-default durations and an omitted policy URL on a venue-only PATCH', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/admin/events', cookies: { nt_session: cookie },
      payload: { ...payload, playMinutes: 12, changeoverMinutes: 4, policyUrl: 'https://example.test/policy' },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;
    const patched = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie },
      payload: { venue: 'Waverley' },
    });
    expect(patched.statusCode).toBe(200);
    const expected = { venue: 'Waverley', playMinutes: 12, changeoverMinutes: 4, policyUrl: 'https://example.test/policy' };
    expect(patched.json()).toMatchObject(expected);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject(expected);
  });

  it('resets an explicitly cleared policy URL to the default', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/admin/events', cookies: { nt_session: cookie },
      payload: { ...payload, policyUrl: 'https://example.test/policy' },
    });
    expect(created.statusCode).toBe(201);
    const eventId = created.json().id as string;
    const patched = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie },
      payload: { policyUrl: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().policyUrl).toBe(DEFAULT_POLICY_URL);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).policyUrl).toBe(DEFAULT_POLICY_URL);
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

  it('never returns the check-in PIN hash from event responses', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty('checkInPinHash');
    const eventId = created.json().id as string;
    await prisma.event.update({ where: { id: eventId }, data: { checkInPinHash: 'scrypt$secret$hash' } });

    const responses = [
      await app.inject({ method: 'GET', url: '/api/admin/events', cookies: { nt_session: cookie } }),
      await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}`, cookies: { nt_session: cookie } }),
      await app.inject({ method: 'PATCH', url: `/api/admin/events/${eventId}`, payload: { courts: 3 }, cookies: { nt_session: cookie } }),
      await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/open`, cookies: { nt_session: cookie } }),
      await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/open`, cookies: { nt_session: cookie } }),
      await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/close`, cookies: { nt_session: cookie } }),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('checkInPinHash');
      expect(response.body).not.toContain('scrypt$secret$hash');
    }
    expect(responses[2].json().courts).toBe(3);
  });

  it('returns 400 with field errors when game start precedes arrival', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/events', payload: { ...payload, gameStartTime: '08:00' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toContain('gameStartTime');
  });

  it('returns 400 when finish is earlier than game start', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/events', payload: { ...payload, endTime: '08:45' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
    expect(res.json().fields).toContain('endTime');
  });
});
