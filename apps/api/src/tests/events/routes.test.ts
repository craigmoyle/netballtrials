import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { DEFAULT_POLICY_URL } from '../../policy';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

const payload = { name: '17/U', competitionYear: 2027, division: '17/U', section: 'Ladies', eventDate: '2026-09-12', venue: 'SNC', startTime: '08:30', endTime: '12:00', gameStartTime: '09:00', registrationClosesAt: '2026-09-11T08:30', registrationFeeCents: 3500, courts: 4, rank1Min: 2, rank2Min: 1, rank3Min: 1, minAge: 14, maxAge: 17 };

describe('event admin routes', () => {
  it('requires an admin session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/events/event-1' })).statusCode).toBe(401);
  });
  it('creates and lists an event with a Melbourne registration deadline', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ startTime: '08:30', gameStartTime: '09:00' });
    expect(created.json().registrationClosesAt).toBe('2026-09-10T22:30:00.000Z');
    expect(created.json()).not.toHaveProperty('lastWhistle');
    const listed = await app.inject({ method: 'GET', url: '/api/admin/events', cookies: { nt_session: cookie } });
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ startTime: '08:30', gameStartTime: '09:00' });
  });
  it('requires a registration deadline on create and rejects a deadline after arrival', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/admin/events', payload: { ...payload, registrationClosesAt: undefined }, cookies: { nt_session: cookie } });
    const late = await app.inject({ method: 'POST', url: '/api/admin/events', payload: { ...payload, registrationClosesAt: '2026-09-12T08:31' }, cookies: { nt_session: cookie } });

    expect(missing.statusCode).toBe(400);
    expect(missing.json().fields).toContain('registrationClosesAt');
    expect(late.statusCode).toBe(400);
    expect(late.json().fields).toContain('registrationClosesAt');
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
    const opened = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/open`, cookies: { nt_session: cookie }, headers: { 'x-test-now': '2026-09-01T00:00:00.000Z' } });
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

  it('hides draft policy PDFs and caches published policy documents briefly', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    const eventId = created.json().id as string;
    await prisma.eventPolicyDocument.create({ data: { eventId, fileName: 'selection.pdf', bytes: Buffer.from('%PDF-1.4 test') } });
    expect((await app.inject({ method: 'GET', url: `/api/public/events/${eventId}/policy-document` })).statusCode).toBe(404);

    await prisma.event.update({ where: { id: eventId }, data: { status: 'OPEN' } });
    const published = await app.inject({ method: 'GET', url: `/api/public/events/${eventId}/policy-document` });
    expect(published.statusCode).toBe(200);
    expect(published.body).toContain('%PDF-1.4');
    expect(published.headers['cache-control']).toBe('public, max-age=300');
    expect(published.headers.pragma).toBeUndefined();
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

  it('blocks deletion while multi-event communication history references the event', async () => {
    const first = await prisma.event.create({ data: eventFixture({ name: 'First event' }) });
    const second = await prisma.event.create({ data: eventFixture({ name: 'Second event' }) });
    const campaign = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: second.id, eventIds: [first.id, second.id], recipientIds: ['association-1'],
      batchId: 'event-delete-reference', subject: 'Association update', body: 'Details', status: 'COMPLETED',
    } });

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/events/${first.id}`, cookies: { nt_session: cookie } });

    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toEqual({ error: 'event_has_communications' });
    expect(await prisma.siteAssociationCommunication.findUnique({ where: { id: campaign.id } })).not.toBeNull();
  });

  it('blocks deletion while ordinary scheduled communication history remains', async () => {
    const event = await prisma.event.create({ data: eventFixture({ name: 'Scheduled event' }) });
    const scheduled = await prisma.scheduledMessage.create({ data: {
      eventId: event.id, audience: 'participants', recipientIds: ['registration-1'], batchId: 'event-delete-scheduled',
      subject: 'Reminder', body: 'Details', scheduledAt: new Date('2099-01-01T00:00:00Z'), status: 'SCHEDULED',
    } });

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/events/${event.id}`, cookies: { nt_session: cookie } });

    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toEqual({ error: 'event_has_communications' });
    expect(await prisma.scheduledMessage.findUnique({ where: { id: scheduled.id } })).not.toBeNull();
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
      await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/open`, cookies: { nt_session: cookie }, headers: { 'x-test-now': '2026-09-01T00:00:00.000Z' } }),
      await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/open`, cookies: { nt_session: cookie }, headers: { 'x-test-now': '2026-09-01T00:00:00.000Z' } }),
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
