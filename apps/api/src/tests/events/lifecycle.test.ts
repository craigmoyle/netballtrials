import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
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
      headers: { 'x-test-now': '2026-09-01T00:00:00.000Z' },
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().status).toBe('OPEN');
    expect((await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` })).statusCode).toBe(200);
    const snapshot = await prisma.eventPolicySnapshot.findFirstOrThrow({ where: { eventId: event.id } });
    expect(snapshot).toMatchObject({ version: 1, competitionYear: 2027, minAge: 12, maxAge: 15 });
    expect(snapshot.policyReference).toBe(`http://localhost:3000/api/public/events/${event.id}/policy-snapshots/1`);
  });

  it('rejects opening a draft whose registration deadline has expired', async () => {
    const event = await prisma.event.create({ data: eventFixture() });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${event.id}/open`,
      cookies: { nt_session: adminCookie }, headers: { 'x-test-now': '2026-09-11T00:00:00.000Z' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'deadline_required' });
    expect(await prisma.eventPolicySnapshot.count({ where: { eventId: event.id } })).toBe(0);
  });

  it('closes an open event once when close requests race', async () => {
    const event = await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) });

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/close`, cookies: { nt_session: adminCookie } }),
      app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/close`, cookies: { nt_session: adminCookie } }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(await prisma.auditEvent.count({ where: { eventId: event.id, action: 'REGISTRATION_CLOSED' } })).toBe(1);
  });

  it('captures an immutable policy PDF when an event opens', async () => {
    const pdf = Buffer.from('%PDF-1.4\nsnapshot policy\n%%EOF');
    const event = await prisma.event.create({ data: eventFixture({ policyDocumentName: 'policy.pdf' }) });
    await prisma.eventPolicyDocument.create({ data: { eventId: event.id, fileName: 'policy.pdf', bytes: pdf } });

    const opened = await app.inject({
      method: 'POST', url: `/api/admin/events/${event.id}/open`, cookies: { nt_session: adminCookie },
      headers: { 'x-test-now': '2026-09-01T00:00:00.000Z' },
    });
    expect(opened.statusCode).toBe(200);
    const snapshot = await prisma.eventPolicySnapshot.findFirstOrThrow({ where: { eventId: event.id } });
    expect(Buffer.from(snapshot.policyDocumentBytes!)).toEqual(pdf);
    expect(snapshot.policyDocumentHash).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(snapshot.policyReference).toBe(`http://localhost:3000/api/public/events/${event.id}/policy-snapshots/1`);

    await prisma.eventPolicyDocument.delete({ where: { eventId: event.id } });
    const publicSnapshot = await app.inject({ method: 'GET', url: snapshot.policyReference });
    expect(publicSnapshot.statusCode).toBe(200);
    expect(publicSnapshot.headers['cache-control']).toContain('immutable');
    expect(publicSnapshot.body).toBe(pdf.toString());
  });

  it('closes an open event while keeping its public details visible', async () => {
    const event = await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) });
    const closed = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${event.id}/close`,
      cookies: { nt_session: adminCookie },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe('CLOSED');
    expect((await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` })).statusCode).toBe(200);
    expect(closed.json().registrationClosedAt).not.toBeNull();
  });

  it('requires a future deadline and explicit confirmation to reopen', async () => {
    const event = await prisma.event.create({ data: eventFixture({ status: 'CLOSED', registrationClosedAt: new Date('2026-01-01T00:00:00Z') }) });
    const missingConfirmation = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/open`, payload: { registrationClosesAt: '2026-09-12T07:30', confirmReopen: false }, cookies: { nt_session: adminCookie } });
    const reopened = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/open`, payload: { registrationClosesAt: '2026-09-12T07:30', confirmReopen: true }, cookies: { nt_session: adminCookie }, headers: { 'x-test-now': '2026-09-11T00:00:00.000Z' } });

    expect(missingConfirmation.statusCode).toBe(409);
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ status: 'OPEN', registrationClosedAt: null });
    expect((await prisma.auditEvent.findMany({ where: { eventId: event.id } })).map((entry) => entry.action)).toContain('REGISTRATION_REOPENED');
  });

  it('requires explicit fresh date values and copies configuration into a new DRAFT clone', async () => {
    const pdf = Buffer.from('%PDF-1.4\nclone policy\n%%EOF');
    const source = await prisma.event.create({ data: eventFixture({ status: 'CLOSED', checkInClosedAt: new Date(), policyDocumentName: 'policy.pdf' }) });
    await prisma.eventPolicyDocument.create({ data: { eventId: source.id, fileName: 'policy.pdf', bytes: pdf } });
    await prisma.registration.create({ data: registrationFixture(source.id) });

    const missing = await app.inject({ method: 'POST', url: `/api/admin/events/${source.id}/clone`, cookies: { nt_session: adminCookie } });
    const cloned = await app.inject({
      method: 'POST', url: `/api/admin/events/${source.id}/clone`, cookies: { nt_session: adminCookie },
      payload: { competitionYear: 2028, eventDate: '2027-09-19', registrationClosesAt: '2027-09-17T18:00' },
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json().fields).toEqual(expect.arrayContaining(['eventDate', 'registrationClosesAt', 'competitionYear']));
    expect(cloned.statusCode).toBe(201);
    expect(cloned.json()).toMatchObject({ status: 'DRAFT', competitionYear: 2028, eventDate: '2027-09-19T00:00:00.000Z', checkInClosedAt: null });
    expect(cloned.json().registrationClosesAt).toBe('2027-09-17T08:00:00.000Z');
    expect(await prisma.registration.count({ where: { eventId: cloned.json().id } })).toBe(0);
    expect(await prisma.eventPolicySnapshot.count({ where: { eventId: cloned.json().id } })).toBe(0);
    expect(Buffer.from((await prisma.eventPolicyDocument.findUniqueOrThrow({ where: { eventId: cloned.json().id } })).bytes)).toEqual(pdf);
    expect(await prisma.auditEvent.count({ where: { eventId: cloned.json().id, action: 'EVENT_CREATED' } })).toBe(1);
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
