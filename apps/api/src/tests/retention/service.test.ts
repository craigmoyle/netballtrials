import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { anonymizeExpiredRegistrations, anonymizeIncompleteRegistrations, pruneParentAccessArtifacts, pruneRateLimitBuckets, retentionCutoff } from '../../retention/service';
import { verifyPlan } from '../../planner/verify';
import { eventFixture, registrationFixture as regFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('retentionCutoff', () => {
  it('uses four calendar years and handles leap-day event dates', () => {
    expect(retentionCutoff(new Date('2025-10-10T00:00:00Z')).toISOString()).toContain('2029-10-10');
    expect(retentionCutoff(new Date('2024-02-29T00:00:00Z')).toISOString()).toContain('2028-02-29');
  });
});

describe('anonymizeExpiredRegistrations', () => {
  it('clears personal data across registration, email, review, check-in, and plan snapshots exactly once', async () => {
    const old = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2021-09-12T00:00:00Z') } });
    const reg = await prisma.registration.create({
      data: {
        ...regFixture(old.id), status: 'PAID', qrToken: 'q'.repeat(43),
        checkoutSessionId: 'cs_personal', paymentIntentId: 'pi_personal',
        parentAuthorityConfirmedAt: new Date('2021-08-01T00:00:00Z'),
        checkedInAt: new Date('2021-09-12T23:00:00Z'), checkedInBy: 'Volunteer name', bibNumber: 7,
      },
    });
    const plan = await prisma.roundPlan.create({
      data: { eventId: old.id, revision: 1, seed: 1, status: 'PUBLISHED', rounds: 1, courts: 1, playMinutes: 8, changeoverMinutes: 2, windowMinutes: 8, rank1Min: 0, rank2Min: 0, rank3Min: 0, eventName: old.name, eventDate: old.eventDate, venue: old.venue, gameStartTime: old.gameStartTime },
    });
    await prisma.roundPlanPlayer.create({ data: { planId: plan.id, registrationId: reg.id, playerName: 'Ada Lovelace', bibNumber: 7, rank1Position: 'GS', optInExtraPositions: false } });
    const historicIds = Array.from({ length: 13 }, (_, index) => `historic-${index}`);
    await prisma.roundPlanPlayer.createMany({ data: historicIds.map((registrationId) => ({ planId: plan.id, registrationId, playerName: 'Historic player', rank1Position: 'GS' as const, optInExtraPositions: true })) });
    const positions = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'] as const;
    const playerIds = [reg.id, ...historicIds];
    const historicSlots = positions.flatMap((position, positionIndex) => [0, 1].map((team) => ({
      planId: plan.id, round: 1, court: 1, position, team: team as 0 | 1,
      registrationId: playerIds[positionIndex * 2 + team],
    })));
    await prisma.roundSlot.createMany({ data: historicSlots });
    const log = await prisma.emailLog.create({
      data: { eventId: old.id, registrationId: reg.id, batchId: `confirmation:${reg.id}`, idempotencyKey: 'retention-test-key', to: 'anne@example.com', subject: 'Ada health information', body: 'Contact Anne about Ada', messagePayload: { html: 'Ada contact details', attachments: [{ filename: 'Ada.ics', contentBase64: 'private' }] }, kind: 'message', status: 'SENT', sentAt: new Date('2025-09-01T00:00:00Z') },
    });
    const eventMessage = await prisma.emailLog.create({
      data: { eventId: old.id, batchId: 'event-message', idempotencyKey: 'event-message-key', to: 'parent@example.com', subject: 'Venue update', body: 'Details about Ada', kind: 'message', status: 'FAILED' },
    });
    const scheduled = await prisma.scheduledMessage.create({ data: {
      eventId: old.id, recipientIds: [reg.id], audience: 'participants', batchId: 'private-scheduled',
      subject: 'Ada private notice', body: 'Contact Anne about Ada', scheduledAt: new Date('2025-09-10T00:00:00Z'),
    } });
    const checkInSession = await prisma.checkInSession.create({
      data: { eventId: old.id, tokenHash: 'a'.repeat(64), expiresAt: new Date('2025-09-13T00:00:00Z') },
    });
    const review = await prisma.reviewItem.create({ data: { eventId: old.id, registrationId: reg.id, reason: 'age_out_of_range', note: 'Birth certificate seen' } });

    const now = new Date('2025-10-10T00:00:00Z');
    expect(await anonymizeExpiredRegistrations(prisma, now)).toBe(1);
    const anonymised = await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } });
    expect(anonymised).toMatchObject({
      playerFirstName: '', playerLastName: '', playerNameNormalized: '', parentName: '', parentEmail: '', parentMobile: '',
      checkedInBy: null, qrToken: null, checkoutSessionId: null, paymentIntentId: null, parentAuthorityConfirmedAt: null,
      status: 'WITHDRAWN', statusBeforeAnonymization: 'PAID', anonymizedAt: now,
    });
    expect(anonymised.dateOfBirth.toISOString()).toContain('1900-01-01');
    expect(await prisma.reviewItem.findUnique({ where: { id: review.id } })).toBeNull();
    const anonymisedLog = await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(anonymisedLog).toMatchObject({ to: '', subject: '', body: '', registrationId: null, error: null, messagePayload: null, status: 'ANONYMIZED', kind: 'retention' });
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: eventMessage.id } })).toMatchObject({ to: '', subject: '', body: '', status: 'ANONYMIZED', kind: 'retention' });
    expect(await prisma.checkInSession.findUnique({ where: { id: checkInSession.id } })).toBeNull();
    expect(await prisma.scheduledMessage.findUnique({ where: { id: scheduled.id } })).toBeNull();
    const player = await prisma.roundPlanPlayer.findUniqueOrThrow({ where: { planId_registrationId: { planId: plan.id, registrationId: anonymised.anonymizedRef! } } });
    expect(player).toMatchObject({ playerName: 'Former participant', bibNumber: null });
    const slots = await prisma.roundSlot.findMany({ where: { planId: plan.id } });
    expect(slots.find((slot) => slot.position === 'GS' && slot.team === 0)?.registrationId).toBe(anonymised.anonymizedRef);
    const players = await prisma.roundPlanPlayer.findMany({ where: { planId: plan.id } });
    expect(verifyPlan({
      courts: 1, rounds: 1, playMinutes: 8, changeoverMinutes: 0, windowMinutes: 8,
      rank1Min: 0, rank2Min: 0, rank3Min: 0,
      players: players.map((player) => ({
        registrationId: player.registrationId, name: player.playerName, bibNumber: player.bibNumber ?? 0,
        rank1: player.rank1Position, rank2: player.rank2Position, rank3: player.rank3Position,
        optInExtra: player.optInExtraPositions,
      })),
    }, { rounds: 1, slots: slots.map(({ round, court, position, team, registrationId }) => ({ round, court, position, team: team as 0 | 1, registrationId })) })).toEqual([]);
    expect(await anonymizeExpiredRegistrations(prisma, now)).toBe(0);
  });

  it('anonymizes unpaid incomplete registrations after 30 days but preserves paid and recent records', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2027-09-12T00:00:00Z') } });
    const now = new Date('2026-10-28T00:00:00Z');
    const staleCreatedAt = new Date(now.getTime() - 31 * 24 * 60 * 60_000);
    const staleUnverified = await prisma.registration.create({
      data: { ...regFixture(event.id), status: 'PENDING', createdAt: staleCreatedAt, expiresAt: new Date(staleCreatedAt.getTime() + 24 * 60 * 60_000) },
    });
    const staleVerified = await prisma.registration.create({
      data: { ...regFixture(event.id, { playerFirstName: 'Grace', playerNameNormalized: 'grace lovelace', parentEmail: 'grace@example.test' }), status: 'EXPIRED', parentEmailVerifiedAt: staleCreatedAt, createdAt: staleCreatedAt, expiresAt: new Date(staleCreatedAt.getTime() + 24 * 60 * 60_000) },
    });
    const paid = await prisma.registration.create({ data: { ...regFixture(event.id, { playerFirstName: 'Paid', playerNameNormalized: 'paid lovelace' }), status: 'PAID', createdAt: staleCreatedAt } });
    const recent = await prisma.registration.create({ data: { ...regFixture(event.id, { playerFirstName: 'Recent', playerNameNormalized: 'recent lovelace' }), status: 'PENDING', createdAt: new Date(now.getTime() - 29 * 24 * 60 * 60_000) } });
    await prisma.parentAccessSession.create({ data: { email: 'grace@example.test', tokenHash: 'parent-session-stale'.padEnd(64, 'x'), expiresAt: new Date(now.getTime() + 60 * 60_000) } });
    await prisma.parentAccessToken.create({ data: { email: 'grace@example.test', purpose: 'SIGN_IN', tokenHash: 'parent-token-stale'.padEnd(64, 'y'), expiresAt: new Date(now.getTime() + 15 * 60_000) } });
    const log = await prisma.emailLog.create({
      data: { eventId: event.id, registrationId: staleUnverified.id, batchId: 'unverified', idempotencyKey: 'unverified-key', to: staleUnverified.parentEmail, subject: 'Confirm email', body: 'Private confirmation link', kind: 'email-verification', status: 'SENT' },
    });

    expect(await anonymizeIncompleteRegistrations(prisma, now)).toBe(2);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: staleUnverified.id } })).toMatchObject({ status: 'WITHDRAWN', parentEmail: '', anonymizedAt: now });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: staleVerified.id } })).toMatchObject({ status: 'WITHDRAWN', parentEmail: '', anonymizedAt: now });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: 'PAID', anonymizedAt: null });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: recent.id } })).toMatchObject({ status: 'PENDING', anonymizedAt: null });
    expect(await prisma.parentAccessSession.findFirst({ where: { email: 'grace@example.test' } })).toBeNull();
    expect(await prisma.parentAccessToken.findFirst({ where: { email: 'grace@example.test' } })).toBeNull();
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ to: '', subject: '', body: '', registrationId: null, status: 'ANONYMIZED' });
    expect(await anonymizeIncompleteRegistrations(prisma, now)).toBe(0);
  });

  it('claims each registration once when retention workers overlap', async () => {
    const old = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2021-09-12T00:00:00Z') } });
    const reg = await prisma.registration.create({ data: { ...regFixture(old.id), status: 'PAID' } });
    const now = new Date('2025-10-10T00:00:00Z');
    const counts = await Promise.all([
      anonymizeExpiredRegistrations(prisma, now),
      anonymizeExpiredRegistrations(prisma, now),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).anonymizedAt).toEqual(now);
  });

  it('does not anonymise an event on its four-calendar-year boundary date', async () => {
    const boundary = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2021-10-10T00:00:00Z') } });
    await prisma.registration.create({ data: { ...regFixture(boundary.id), status: 'PAID' } });
    expect(await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T12:59:59Z'))).toBe(0);
    expect(await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T13:00:00Z'))).toBe(1);
  });

  it('anonymises member association and many email logs in one pass', async () => {
    const old = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2021-09-12T00:00:00Z') } });
    const reg = await prisma.registration.create({ data: { ...regFixture(old.id), status: 'PAID' } });
    await prisma.emailLog.createMany({
      data: Array.from({ length: 1500 }, (_, index) => ({
        eventId: old.id, registrationId: index % 2 ? reg.id : null, batchId: `batch-${index % 3}`,
        idempotencyKey: `key-${index}`, to: `parent${index}@example.com`, subject: 'Private', body: 'Private body',
        messagePayload: { html: 'private' }, error: 'provider_rejected_403', kind: 'message', status: 'SENT' as const,
      })),
    });
    const current = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2025-09-12T00:00:00Z') } });
    const kept = await prisma.emailLog.create({
      data: { eventId: current.id, batchId: 'current', idempotencyKey: 'current-key', to: 'keep@example.com', subject: 'Keep', body: 'Keep', kind: 'message', status: 'SENT' },
    });

    expect(await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T00:00:00Z'))).toBe(1);

    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } })).memberAssociation).toBe('');
    const logs = await prisma.emailLog.findMany({ where: { eventId: old.id } });
    expect(logs).toHaveLength(1500);
    expect(logs.every((log) => log.status === 'ANONYMIZED' && log.to === '' && log.subject === '' && log.body === ''
      && log.messagePayload === null && log.error === null && log.registrationId === null && log.kind === 'retention'
      && log.batchId === `retained:${log.id}` && log.idempotencyKey === `retained:${log.id}`)).toBe(true);
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ to: 'keep@example.com', status: 'SENT' });
    expect(await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T00:00:00Z'))).toBe(0);
  });

  it('prunes expired parent-access tokens and sessions while preserving live ones', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    await prisma.parentAccessToken.createMany({
      data: [
        { email: 'expired@example.test', purpose: 'SIGN_IN', tokenHash: 'a'.repeat(64), expiresAt: new Date(now.getTime() - 1), createdAt: new Date(now.getTime() - 60_000) },
        { email: 'active@example.test', purpose: 'SIGN_IN', tokenHash: 'b'.repeat(64), expiresAt: new Date(now.getTime() + 60_000), createdAt: now },
      ],
    });
    await prisma.parentAccessSession.createMany({
      data: [
        { email: 'expired@example.test', tokenHash: 'c'.repeat(64), expiresAt: new Date(now.getTime() - 1), createdAt: new Date(now.getTime() - 60_000) },
        { email: 'active@example.test', tokenHash: 'd'.repeat(64), expiresAt: new Date(now.getTime() + 60_000), createdAt: now },
      ],
    });

    expect(await pruneParentAccessArtifacts(prisma, now)).toEqual({ tokens: 1, sessions: 1 });
    expect(await prisma.parentAccessToken.findUnique({ where: { tokenHash: 'a'.repeat(64) } })).toBeNull();
    expect(await prisma.parentAccessToken.findUnique({ where: { tokenHash: 'b'.repeat(64) } })).not.toBeNull();
    expect(await prisma.parentAccessSession.findUnique({ where: { tokenHash: 'c'.repeat(64) } })).toBeNull();
    expect(await prisma.parentAccessSession.findUnique({ where: { tokenHash: 'd'.repeat(64) } })).not.toBeNull();
  });

  it('deletes rate-limit buckets idle for more than a day', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    await prisma.requestRateLimitBucket.createMany({
      data: [
        { key: 'stale', windowStartedAt: new Date('2026-10-08T00:00:00Z'), hits: 3, updatedAt: new Date('2026-10-08T23:59:59Z') },
        { key: 'fresh', windowStartedAt: new Date('2026-10-09T12:00:00Z'), hits: 1, updatedAt: new Date('2026-10-09T12:00:00Z') },
      ],
    });
    expect(await pruneRateLimitBuckets(prisma, now)).toBe(1);
    expect((await prisma.requestRateLimitBucket.findMany()).map((bucket) => bucket.key)).toEqual(['fresh']);
  });
});
