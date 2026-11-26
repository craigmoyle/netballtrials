import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { anonymizeExpiredRegistrations, anonymizeIncompleteRegistrations, earliestRetainedEventDate, pruneParentAccessArtifacts, pruneRateLimitBuckets, pruneStaffAuthArtifacts, retentionCutoff } from '../../retention/service';
import { verifyPlan } from '../../planner/verify';
import { listReviewQueue } from '../../review/service';
import { eventFixture, registrationFixture as regFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('retentionCutoff', () => {
  it('uses four calendar years and handles leap-day event dates', () => {
    expect(retentionCutoff(new Date('2025-10-10T00:00:00Z')).toISOString()).toContain('2029-10-10');
    expect(retentionCutoff(new Date('2024-02-29T00:00:00Z')).toISOString()).toContain('2028-02-29');
    expect(earliestRetainedEventDate(new Date('2028-02-29T12:00:00Z')).toISOString()).toContain('2024-02-29');
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
    const orphanPaymentReview = await prisma.reviewItem.create({ data: { eventId: old.id, registrationId: reg.id, reason: 'payment_without_registration', note: 'Refund or reinstate manually.' } });
    const changeLog = await prisma.registrationChangeLog.create({
      data: { registrationId: reg.id, actorType: 'PARENT', changedFields: ['parentEmail'], changeData: { parentEmail: { from: 'old@example.com', to: 'anne@example.com' } } },
    });
    await prisma.parentAccessToken.create({ data: { email: reg.parentEmail, registrationId: reg.id, purpose: 'SIGN_IN', tokenHash: 'full-event-token'.padEnd(64, 'x'), expiresAt: new Date('2030-01-01T00:00:00Z') } });
    await prisma.parentAccessSession.create({ data: { email: reg.parentEmail, tokenHash: 'full-event-session'.padEnd(64, 'y'), expiresAt: new Date('2030-01-01T00:00:00Z') } });

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
    expect(await prisma.reviewItem.findUnique({ where: { id: orphanPaymentReview.id } })).toMatchObject({
      reason: 'payment_without_registration', note: null, resolvedAt: null,
    });
    expect(await listReviewQueue(prisma, old.id)).toEqual([
      expect.objectContaining({
        id: orphanPaymentReview.id,
        reason: 'payment_without_registration',
        note: null,
      }),
    ]);
    expect(await prisma.registrationChangeLog.findUnique({ where: { id: changeLog.id } })).toBeNull();
    expect(await prisma.parentAccessToken.findUnique({ where: { tokenHash: 'full-event-token'.padEnd(64, 'x') } })).toBeNull();
    expect(await prisma.parentAccessSession.findUnique({ where: { tokenHash: 'full-event-session'.padEnd(64, 'y') } })).toBeNull();
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

  it('removes personal data from retained plan validation warnings', async () => {
    const old = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-09-12T00:00:00Z') }) });
    const registration = await prisma.registration.create({ data: regFixture(old.id, {
      playerFirstName: 'Private', playerLastName: 'Player', playerNameNormalized: 'private player', status: 'PAID',
    }) });
    const plan = await prisma.roundPlan.create({ data: {
      eventId: old.id, revision: 1, seed: 1, status: 'PUBLISHED', rounds: 1, courts: 1, playMinutes: 8,
      changeoverMinutes: 2, windowMinutes: 10, eventName: old.name, eventDate: old.eventDate, venue: old.venue, gameStartTime: old.gameStartTime,
      validationWarnings: [{ code: 'missing_court_visit', message: 'Private Player does not play on court 1.', detail: { registrationId: registration.id, court: 1 } }],
    } });

    expect(await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T00:00:00Z'))).toBe(1);
    expect((await prisma.roundPlan.findUniqueOrThrow({ where: { id: plan.id } })).validationWarnings).toEqual([]);
  });

  it('retains a legacy multi-event campaign until every referenced event expires', async () => {
    const old = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-09-12T00:00:00Z') }) });
    const later = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2024-09-12T00:00:00Z') }) });
    const association = await prisma.memberAssociation.create({ data: { name: 'Legacy campaign association' } });
    const campaign = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: old.id, eventIds: [old.id, later.id], recipientIds: [association.id],
      batchId: 'legacy-multi-event', subject: 'Legacy subject', body: 'Legacy body', status: 'COMPLETED',
    } });
    const delivery = await prisma.emailLog.create({ data: {
      eventId: old.id, siteCommunicationId: campaign.id, associationId: association.id,
      batchId: campaign.batchId, idempotencyKey: 'legacy-multi-event:delivery', to: 'association@example.test',
      subject: 'Legacy subject', body: 'Legacy body', kind: 'association', status: 'SENT',
    } });

    await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T00:00:00Z'));

    expect(await prisma.siteAssociationCommunication.findUnique({ where: { id: campaign.id } })).not.toBeNull();
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'SENT', subject: 'Legacy subject', body: 'Legacy body',
    });
  });

  it('expires a legacy campaign when a deleted referenced event cannot retain it', async () => {
    const old = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-09-12T00:00:00Z') }) });
    const deleted = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2024-09-12T00:00:00Z') }) });
    const association = await prisma.memberAssociation.create({ data: { name: 'Deleted-event association' } });
    const campaign = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: old.id, eventIds: [old.id, deleted.id], recipientIds: [association.id],
      batchId: 'deleted-event-campaign', subject: 'Old campaign', body: 'Old body', status: 'COMPLETED',
    } });
    await prisma.emailLog.create({ data: {
      eventId: old.id, siteCommunicationId: campaign.id, batchId: campaign.batchId, idempotencyKey: 'deleted-event-delivery',
      to: 'association@example.test', subject: 'Old campaign', body: 'Old body', kind: 'association', status: 'SENT',
    } });
    await prisma.event.delete({ where: { id: deleted.id } });

    await anonymizeExpiredRegistrations(prisma, new Date('2025-10-10T00:00:00Z'));

    expect(await prisma.siteAssociationCommunication.findUnique({ where: { id: campaign.id } })).toBeNull();
    expect(await prisma.emailLog.findFirst({ where: { batchId: campaign.batchId } })).toBeNull();
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
    const staleChange = await prisma.registrationChangeLog.create({
      data: { registrationId: staleVerified.id, actorType: 'PARENT', changedFields: ['parentName'], changeData: { parentName: { from: 'Old', to: 'New' } } },
    });
    const orphanPaymentReview = await prisma.reviewItem.create({
      data: { eventId: event.id, registrationId: staleVerified.id, reason: 'payment_without_registration', note: 'Refund or reinstate manually.' },
    });
    const paid = await prisma.registration.create({ data: { ...regFixture(event.id, { playerFirstName: 'Paid', playerNameNormalized: 'paid lovelace' }), status: 'PAID', paidAt: staleCreatedAt, createdAt: staleCreatedAt } });
    const staleWithdrawn = await prisma.registration.create({ data: { ...regFixture(event.id, { playerFirstName: 'Withdrawn', playerNameNormalized: 'withdrawn lovelace', parentEmail: 'withdrawn@example.test' }), status: 'WITHDRAWN', createdAt: staleCreatedAt } });
    const paidWithdrawn = await prisma.registration.create({ data: { ...regFixture(event.id, { playerFirstName: 'PaidWithdrawn', playerNameNormalized: 'paidwithdrawn lovelace' }), status: 'WITHDRAWN', paidAt: staleCreatedAt, createdAt: staleCreatedAt } });
    const recent = await prisma.registration.create({ data: { ...regFixture(event.id, { playerFirstName: 'Recent', playerNameNormalized: 'recent lovelace' }), status: 'PENDING', createdAt: new Date(now.getTime() - 29 * 24 * 60 * 60_000) } });
    await prisma.parentAccessSession.create({ data: { email: 'grace@example.test', tokenHash: 'parent-session-stale'.padEnd(64, 'x'), expiresAt: new Date(now.getTime() + 60 * 60_000) } });
    await prisma.parentAccessToken.create({ data: { email: 'grace@example.test', purpose: 'SIGN_IN', tokenHash: 'parent-token-stale'.padEnd(64, 'y'), expiresAt: new Date(now.getTime() + 15 * 60_000) } });
    const log = await prisma.emailLog.create({
      data: { eventId: event.id, registrationId: staleUnverified.id, batchId: 'unverified', idempotencyKey: 'unverified-key', to: staleUnverified.parentEmail, subject: 'Confirm email', body: 'Private confirmation link', kind: 'email-verification', status: 'SENT' },
    });

    expect(await anonymizeIncompleteRegistrations(prisma, now)).toBe(3);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: staleUnverified.id } })).toMatchObject({ status: 'WITHDRAWN', parentEmail: '', anonymizedAt: now });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: staleVerified.id } })).toMatchObject({ status: 'WITHDRAWN', parentEmail: '', anonymizedAt: now });
    expect(await prisma.registrationChangeLog.findUnique({ where: { id: staleChange.id } })).toBeNull();
    expect(await prisma.reviewItem.findUnique({ where: { id: orphanPaymentReview.id } })).toMatchObject({ reason: 'payment_without_registration' });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: 'PAID', anonymizedAt: null });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: staleWithdrawn.id } })).toMatchObject({ status: 'WITHDRAWN', parentEmail: '', anonymizedAt: now });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: paidWithdrawn.id } })).toMatchObject({ status: 'WITHDRAWN', parentEmail: 'anne@example.com', anonymizedAt: null });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: recent.id } })).toMatchObject({ status: 'PENDING', anonymizedAt: null });
    expect(await prisma.parentAccessSession.findFirst({ where: { email: 'grace@example.test' } })).toBeNull();
    expect(await prisma.parentAccessToken.findFirst({ where: { email: 'grace@example.test' } })).toBeNull();
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ to: '', subject: '', body: '', registrationId: null, status: 'ANONYMIZED' });
    expect(await anonymizeIncompleteRegistrations(prisma, now)).toBe(0);
  });

  it('scrubs orphan payment review notes when an incomplete registration expires', async () => {
    const now = new Date('2026-10-28T00:00:00Z');
    const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2027-09-12T00:00:00Z') }) });
    const registration = await prisma.registration.create({ data: regFixture(event.id, {
      status: 'EXPIRED', createdAt: new Date('2026-09-01T00:00:00Z'), parentEmail: 'orphan-private@example.test',
    }) });
    const review = await prisma.reviewItem.create({ data: {
      eventId: event.id, registrationId: registration.id, reason: 'payment_without_registration',
      note: 'Contact the payer at orphan-private@example.test', resolutionHistory: [{ note: 'Name and email' }],
    } });

    expect(await anonymizeIncompleteRegistrations(prisma, now)).toBe(1);
    expect(await prisma.reviewItem.findUniqueOrThrow({ where: { id: review.id } })).toMatchObject({ note: null, resolutionHistory: null });
  });

  it('removes shared parent artifacts when two expired events are retained concurrently', async () => {
    const now = new Date('2025-10-10T00:00:00Z');
    const email = 'shared-retention@example.test';
    for (const suffix of ['a', 'b']) {
      const event = await prisma.event.create({ data: { ...eventFixture(), name: `Expired ${suffix}`, eventDate: new Date(`2021-09-${suffix === 'a' ? '11' : '12'}T00:00:00Z`) } });
      await prisma.registration.create({ data: regFixture(event.id, { parentEmail: email, status: 'PAID' }) });
    }
    await prisma.parentAccessToken.create({ data: { email, purpose: 'SIGN_IN', tokenHash: 'shared-retention-token'.padEnd(64, 'x'), expiresAt: new Date('2030-01-01T00:00:00Z') } });
    await prisma.parentAccessSession.create({ data: { email, tokenHash: 'shared-retention-session'.padEnd(64, 'y'), expiresAt: new Date('2030-01-01T00:00:00Z') } });

    const counts = await Promise.all([
      anonymizeExpiredRegistrations(prisma, now),
      anonymizeExpiredRegistrations(prisma, now),
    ]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(await prisma.parentAccessToken.findUnique({ where: { tokenHash: 'shared-retention-token'.padEnd(64, 'x') } })).toBeNull();
    expect(await prisma.parentAccessSession.findUnique({ where: { tokenHash: 'shared-retention-session'.padEnd(64, 'y') } })).toBeNull();
  });

  it('preserves grouped household deliveries for a retained paid sibling', async () => {
    const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2027-09-12T00:00:00Z') }) });
    const now = new Date('2026-10-28T00:00:00Z');
    const expired = await prisma.registration.create({ data: regFixture(event.id, { playerFirstName: 'Expired', status: 'PENDING', createdAt: new Date('2026-09-01T00:00:00Z'), parentEmail: 'family@example.test' }) });
    const recent = await prisma.registration.create({ data: regFixture(event.id, { playerFirstName: 'Recent', playerNameNormalized: 'recent player', status: 'PAID', parentEmail: 'family@example.test', createdAt: now }) });
    const delivery = await prisma.emailLog.create({ data: {
      eventId: event.id, registrationId: recent.id, registrationIds: [expired.id, recent.id], batchId: 'grouped-household',
      idempotencyKey: 'grouped-household', to: 'family@example.test', subject: 'Expired and Recent', body: 'Expired Player; Recent Player', kind: 'message', status: 'SENT',
    } });

    expect(await anonymizeIncompleteRegistrations(prisma, now)).toBe(1);

    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'SENT', to: 'family@example.test', subject: '', body: '', messagePayload: null,
      registrationId: recent.id, registrationIds: [recent.id],
    });
  });

  it('does not retry an anonymised failed household message', async () => {
    const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2027-09-12T00:00:00Z') }) });
    const now = new Date('2026-10-28T00:00:00Z');
    const expired = await prisma.registration.create({ data: regFixture(event.id, {
      playerFirstName: 'Expired', playerLastName: 'Failed', playerNameNormalized: 'expired failed',
      status: 'PENDING', createdAt: new Date('2026-09-01T00:00:00Z'), parentEmail: 'failed-family@example.test',
    }) });
    const retained = await prisma.registration.create({ data: regFixture(event.id, {
      playerFirstName: 'Retained', playerLastName: 'Failed', playerNameNormalized: 'retained failed',
      status: 'PAID', parentEmail: 'failed-family@example.test',
    }) });
    const delivery = await prisma.emailLog.create({ data: {
      eventId: event.id, registrationId: expired.id, registrationIds: [expired.id, retained.id],
      batchId: 'failed-family-batch', idempotencyKey: 'failed-family-delivery', to: 'failed-family@example.test',
      subject: 'Update for Expired and Retained', body: 'Personal update', kind: 'message', status: 'FAILED', attempts: 1,
    } });

    await anonymizeIncompleteRegistrations(prisma, now);

    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'ANONYMIZED', registrationId: retained.id, registrationIds: [retained.id], subject: '', body: '',
    });
  });

  it('keeps a retained old-address security notice after its incomplete sibling expires', async () => {
    const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2027-09-12T00:00:00Z') }) });
    const now = new Date('2026-10-28T00:00:00Z');
    const expired = await prisma.registration.create({ data: regFixture(event.id, {
      playerFirstName: 'Expired', playerLastName: 'Sibling', playerNameNormalized: 'expired sibling',
      status: 'PENDING', createdAt: new Date('2026-09-01T00:00:00Z'), parentEmail: 'new@example.test',
    }) });
    const retained = await prisma.registration.create({ data: regFixture(event.id, {
      playerFirstName: 'Retained', playerLastName: 'Sibling', playerNameNormalized: 'retained sibling',
      status: 'PAID', parentEmail: 'new@example.test',
    }) });
    const notice = await prisma.emailLog.create({ data: {
      eventId: event.id, registrationId: expired.id, registrationIds: [expired.id, retained.id],
      batchId: 'email-change-shared', idempotencyKey: 'email-change-shared:old',
      to: 'old@example.test', subject: 'Your Netball Trials email was changed', body: 'Review this change.',
      kind: 'email-change', status: 'PENDING',
    } });

    await anonymizeIncompleteRegistrations(prisma, now);

    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: notice.id } })).toMatchObject({
      status: 'PENDING', registrationId: retained.id, registrationIds: [retained.id],
      subject: 'Your Netball Trials email was changed', body: 'Review this change.',
    });
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

  it('prunes expired Admin login links and sessions while preserving live sessions', async () => {
    const user = await prisma.staffUser.create({ data: { email: 'retention-admin@example.test' } });
    const now = new Date('2026-10-10T00:00:00Z');
    await prisma.loginToken.createMany({
      data: [
        { userId: user.id, tokenHash: 'e'.repeat(64), expiresAt: new Date(now.getTime() - 1), createdAt: new Date(now.getTime() - 60_000) },
        { userId: user.id, tokenHash: 'f'.repeat(64), expiresAt: new Date(now.getTime() + 60_000), createdAt: now },
      ],
    });
    await prisma.session.createMany({
      data: [
        { userId: user.id, tokenHash: 'g'.repeat(64), expiresAt: new Date(now.getTime() - 1), createdAt: new Date(now.getTime() - 60_000) },
        { userId: user.id, tokenHash: 'h'.repeat(64), expiresAt: new Date(now.getTime() + 60_000), createdAt: now },
      ],
    });

    expect(await pruneStaffAuthArtifacts(prisma, now)).toEqual({ tokens: 1, sessions: 1 });
    expect(await prisma.loginToken.findUnique({ where: { tokenHash: 'e'.repeat(64) } })).toBeNull();
    expect(await prisma.loginToken.findUnique({ where: { tokenHash: 'f'.repeat(64) } })).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { tokenHash: 'g'.repeat(64) } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { tokenHash: 'h'.repeat(64) } })).not.toBeNull();
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
