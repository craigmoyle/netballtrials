import { beforeEach, describe, expect, it } from 'vitest';
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
  eventId = (await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) })).id;
});

describe('admin roster routes', () => {
  it('corrects a registration date of birth and member association without changing payment or check-in data', async () => {
    await prisma.memberAssociation.createMany({ data: [{ name: 'MENA' }, { name: 'Other Association' }] });
    const checkedInAt = new Date('2026-09-12T01:00:00.000Z');
    const paidAt = new Date('2026-08-20T02:00:00.000Z');
    const registration = await prisma.registration.create({
      data: registrationFixture(eventId, {
        dateOfBirth: new Date('2011-04-02T00:00:00.000Z'), ageFlagged: true,
        status: 'PAID', amountCents: 3500, currency: 'aud', paymentIntentId: 'pi_preserved', paidAt,
        bibNumber: 7, checkedInAt, checkedInBy: 'volunteer',
      }),
    });

    expect((await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/${registration.id}`,
      payload: { dateOfBirth: '2013-04-02', memberAssociation: 'Other Association', reason: 'Confirmed by guardian' },
    })).statusCode).toBe(401);

    const response = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/${registration.id}`,
      cookies: { nt_session: cookie },
      payload: { dateOfBirth: '2013-04-02', memberAssociation: 'Other Association', reason: 'Confirmed by guardian by phone' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: registration.id, dateOfBirth: '2013-04-02', memberAssociation: 'Other Association',
      ageFlagged: false, status: 'PAID', amountCents: 3500, currency: 'aud', bibNumber: 7,
      checkedInAt: checkedInAt.toISOString(),
    });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({
      status: 'PAID', amountCents: 3500, currency: 'aud', paymentIntentId: 'pi_preserved', paidAt,
      bibNumber: 7, checkedInAt, checkedInBy: 'volunteer', ageFlagged: false,
    });
    expect(await prisma.registrationChangeLog.findFirstOrThrow({ where: { registrationId: registration.id } })).toMatchObject({
      actorType: 'ADMIN',
      changedFields: ['dateOfBirth', 'memberAssociation', 'ageFlagged'],
      changeData: {
        dateOfBirth: { from: '2011-04-02', to: '2013-04-02' },
        memberAssociation: { from: 'MENA', to: 'Other Association' },
        ageFlagged: { from: true, to: false },
      },
    });
  });

  it('rejects a DOB correction that is ineligible under the registration policy snapshot without mutating it', async () => {
    const policy = await prisma.eventPolicySnapshot.create({ data: {
      eventId, version: 1, policyReference: 'snapshot-policy', competitionYear: 2027,
      minAge: 12, maxAge: 15,
    } });
    const registration = await prisma.registration.create({ data: registrationFixture(eventId, {
      status: 'PAID', policySnapshotId: policy.id, ageFlagged: false,
      dateOfBirth: new Date('2012-04-02T00:00:00.000Z'),
    }) });

    const response = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/${registration.id}`,
      cookies: { nt_session: cookie }, payload: { dateOfBirth: '2009-04-02', reason: 'Confirmed by guardian' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'ineligible', competitionYear: 2027, minAge: 12, maxAge: 15 });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({
      dateOfBirth: registration.dateOfBirth, ageFlagged: false,
    });
    expect(await prisma.registrationChangeLog.count({ where: { registrationId: registration.id } })).toBe(0);
  });

  it('returns 400 for an invalid calendar date or inactive member association', async () => {
    await prisma.memberAssociation.create({ data: { name: 'Inactive Association', active: false } });
    const registration = await prisma.registration.create({ data: registrationFixture(eventId) });

    const invalidDate = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/${registration.id}`,
      cookies: { nt_session: cookie }, payload: { dateOfBirth: '2011-02-29', reason: 'Confirmed by guardian' },
    });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.json()).toMatchObject({ error: 'validation_failed', fields: ['dateOfBirth'] });

    const inactiveAssociation = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/${registration.id}`,
      cookies: { nt_session: cookie }, payload: { memberAssociation: 'Inactive Association', reason: 'Confirmed by guardian' },
    });
    expect(inactiveAssociation.statusCode).toBe(400);
    expect(inactiveAssociation.json()).toMatchObject({ error: 'validation_failed', fields: ['memberAssociation'] });
  });

  it('returns 409 for an exact normalized-name and date duplicate active in the same event', async () => {
    await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });
    const registration = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID' }) });
    await prisma.registration.create({
      data: registrationFixture(eventId, {
        playerFirstName: 'ada', playerLastName: '  Lovelace', playerNameNormalized: 'ada lovelace',
        dateOfBirth: new Date('2012-04-02T00:00:00.000Z'), parentEmail: 'other@example.com', status: 'PENDING',
      }),
    });

    const response = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/${registration.id}`,
      cookies: { nt_session: cookie }, payload: { dateOfBirth: '2012-04-02', reason: 'Confirmed by guardian' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'already_registered' });
  });

  it('returns 404 when the event or registration is missing', async () => {
    const registration = await prisma.registration.create({ data: registrationFixture(eventId) });
    const otherEvent = await prisma.event.create({ data: eventFixture({ name: '17/U Ladies', competitionYear: 2028 }) });

    const wrongEvent = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${otherEvent.id}/registrations/${registration.id}`,
      cookies: { nt_session: cookie }, payload: { memberAssociation: 'MENA', reason: 'Confirmed by guardian' },
    });
    const missing = await app.inject({
      method: 'PATCH', url: `/api/admin/events/${eventId}/registrations/missing-registration`,
      cookies: { nt_session: cookie }, payload: { memberAssociation: 'MENA', reason: 'Confirmed by guardian' },
    });
    expect(wrongEvent.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
  });

  it('requires an admin session and returns limited roster plus position-choice counts', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, {
        playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
        rank1Position: 'GS', rank2Position: 'WA', optInExtraPositions: true, status: 'PAID', bibNumber: 4, checkedInAt: new Date('2026-09-12T00:00:00Z'),
      }),
    });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster` })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      positionCounts: { rank1: { GS: 1 }, rank2: { WA: 1 }, extraOptIn: 1 },
      registrations: [{ playerName: 'Ada Lovelace', parentEmail: 'anne@example.com', bibNumber: 4 }],
    });
    expect(JSON.stringify(response.json())).not.toContain('qrToken');
  });

  it('removes a paid player with a reason, preserves payment and attendance history, and appends a roster snapshot', async () => {
    const registration = await prisma.registration.create({ data: registrationFixture(eventId, {
      status: 'PAID', paidAt: new Date('2026-08-20T00:00:00Z'), paymentIntentId: 'pi_preserved',
      bibNumber: 4, checkedInAt: new Date('2026-09-12T00:00:00Z'), checkedInBy: 'Volunteer',
    }) });
    await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/close`, cookies: { nt_session: cookie }, headers: { 'x-test-now': '2026-09-12T00:00:00.000Z' } });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${registration.id}/remove`,
      cookies: { nt_session: cookie }, payload: { reason: 'Unable to attend', note: 'Family left before trial play.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: registration.id, status: 'WITHDRAWN' });
    const removed = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(removed).toMatchObject({
      status: 'WITHDRAWN', paidAt: registration.paidAt, paymentIntentId: 'pi_preserved',
      bibNumber: 4, checkedInAt: registration.checkedInAt, removalReason: 'Unable to attend',
      removalNote: 'Family left before trial play.',
    });
    expect(removed.removedAt).toBeTruthy();
    expect(await prisma.rosterSnapshot.count({ where: { eventId } })).toBe(2);
    expect(await prisma.auditEvent.findFirst({ where: { registrationId: registration.id, action: 'REGISTRATION_REMOVED' } })).toBeTruthy();
  });

  it('requires a note for Other and otherwise preserves the registration unchanged', async () => {
    const registration = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID' }) });
    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${registration.id}/remove`,
      cookies: { nt_session: cookie }, payload: { reason: 'Other' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_failed', fields: ['note'] });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({
      status: 'PAID', removedAt: null, removalReason: null,
    });
  });

  it('marks an exact event/player duplicate while retaining the paid source and both histories', async () => {
    const authoritative = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', dateOfBirth: new Date('2012-04-02T00:00:00Z'), paidAt: new Date(), paymentIntentId: 'pi_primary' }) });
    const duplicate = await prisma.registration.create({ data: registrationFixture(eventId, {
      parentEmail: 'other@example.com', dateOfBirth: new Date('2012-04-02T00:00:00Z'), status: 'EXPIRED', paidAt: new Date(), paymentIntentId: 'pi_duplicate',
      bibNumber: 9, checkedInAt: new Date(),
    }) });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${duplicate.id}/duplicate`,
      cookies: { nt_session: cookie }, payload: { duplicateOfRegistrationId: authoritative.id, reason: 'Duplicate' },
    });

    expect(response.statusCode).toBe(200);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({
      status: 'DUPLICATE', duplicateOfRegistrationId: authoritative.id, removalReason: 'Duplicate',
      paymentIntentId: 'pi_duplicate', bibNumber: 9,
    });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: authoritative.id } })).toMatchObject({ status: 'PAID' });
    expect(await prisma.auditEvent.count({ where: { registrationId: duplicate.id, action: 'REGISTRATION_MARKED_DUPLICATE' } })).toBe(1);
  });

  it.each(['EXPIRED', 'WITHDRAWN'] as const)('rejects a %s retained registration without mutating either row', async (status) => {
    const authoritative = await prisma.registration.create({ data: registrationFixture(eventId, { status }) });
    const duplicate = await prisma.registration.create({ data: registrationFixture(eventId, {
      parentEmail: 'other@example.com', status: 'PAID', ageFlagged: false,
    }) });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${duplicate.id}/duplicate`,
      cookies: { nt_session: cookie }, payload: { duplicateOfRegistrationId: authoritative.id, reason: 'Duplicate' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'invalid_duplicate' });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({
      status: 'PAID', duplicateOfRegistrationId: null, removedAt: null,
    });
  });

  it('rejects an age-flagged retained registration', async () => {
    const authoritative = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', ageFlagged: true, dateOfBirth: new Date('2012-04-02T00:00:00Z') }) });
    const duplicate = await prisma.registration.create({ data: registrationFixture(eventId, { parentEmail: 'other@example.com', status: 'EXPIRED', dateOfBirth: new Date('2012-04-02T00:00:00Z') }) });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${duplicate.id}/duplicate`,
      cookies: { nt_session: cookie }, payload: { duplicateOfRegistrationId: authoritative.id, reason: 'Duplicate' },
    });

    expect(response.statusCode).toBe(409);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({ status: 'EXPIRED', removedAt: null });
  });

  it('rejects an unflagged retained row whose DOB is outside its policy range', async () => {
    const authoritative = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', dateOfBirth: new Date('2010-04-02T00:00:00Z'), ageFlagged: false }) });
    const duplicate = await prisma.registration.create({ data: registrationFixture(eventId, { parentEmail: 'other@example.com', status: 'EXPIRED', dateOfBirth: authoritative.dateOfBirth }) });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/registrations/${duplicate.id}/duplicate`,
      cookies: { nt_session: cookie }, payload: { duplicateOfRegistrationId: authoritative.id, reason: 'Duplicate' },
    });

    expect(response.statusCode).toBe(409);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: duplicate.id } })).toMatchObject({ status: 'EXPIRED', removedAt: null });
  });

  it('exports an admin-only formula-neutralized CSV', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, {
        playerFirstName: '=HYPERLINK("https://evil.example")', playerLastName: 'Ng, Jr',
        playerNameNormalized: 'formula player', parentName: '@SUM(1)', parentEmail: 'parent@example.com', memberAssociation: 'Ng, Jr',
        status: 'PAID',
      }),
    });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster/export` })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster/export`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('.csv');
    expect(response.body.split('\r\n')[0]).toContain('"Number"');
    expect(response.body.split('\r\n')[0]).not.toMatch(/Bib/i);
    expect(response.body).toContain("'=HYPERLINK(");
    expect(response.body).toContain("'@SUM(1)");
    expect(response.body).toContain('"Ng, Jr"');
    expect(response.body).not.toMatch(/qrToken|paymentIntentId|checkoutSessionId/);
  });

  it('stops exporting after the retention cutoff', async () => {
    const old = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-01-01T00:00:00Z') }) });
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${old.id}/roster/export`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: 'roster_retention_expired' });
  });
});
