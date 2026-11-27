import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../db';
import { resetDb } from './helpers/db';
import { eventFixture, registrationFixture } from './helpers/fixtures';

beforeEach(resetDb);

describe('StaffUser persistence', () => {
  it('stores and reads an admin by unique email', async () => {
    await prisma.staffUser.create({ data: { email: 'craig@example.com', role: 'ADMIN' } });
    const found = await prisma.staffUser.findUnique({ where: { email: 'craig@example.com' } });
    expect(found?.role).toBe('ADMIN');
  });
});

describe('Trials persistence foundation', () => {
  it('stores policy, duplicate, roster and audit records without losing ineligible registrations', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const retained = await prisma.registration.create({ data: registrationFixture(event.id, { ageFlagged: true }) });
    const policy = await prisma.eventPolicySnapshot.create({ data: {
      eventId: event.id, version: 1, policyReference: 'legacy-policy', competitionYear: event.competitionYear,
      minAge: event.minAge, maxAge: event.maxAge, policyUrl: event.policyUrl,
    } });
    await prisma.registration.update({ where: { id: retained.id }, data: { policySnapshotId: policy.id } });
    const duplicate = await prisma.registration.create({ data: registrationFixture(event.id, {
      playerFirstName: 'Ada duplicate', playerNameNormalized: 'ada duplicate lovelace', status: 'DUPLICATE',
      duplicateOfRegistrationId: retained.id, policySnapshotId: policy.id,
      removedAt: new Date(), removalReason: 'Duplicate',
    }) });
    const roster = await prisma.rosterSnapshot.create({ data: {
      eventId: event.id, revision: 1, reconstructed: true, data: { registrations: [retained.id] },
    } });
    const audit = await prisma.auditEvent.create({ data: {
      eventId: event.id, action: 'registration.mark_duplicate', entityType: 'Registration', entityId: duplicate.id,
      reason: 'Same event player and DOB', afterState: { status: 'DUPLICATE', duplicateOfRegistrationId: retained.id },
    } });
    const delivery = await prisma.emailLog.create({ data: {
      eventId: event.id, registrationId: retained.id, batchId: 'foundation', idempotencyKey: 'foundation',
      to: 'anne@example.com', subject: 'Foundation', body: 'Foundation', kind: 'review',
    } });
    await prisma.reviewItem.create({ data: {
      eventId: event.id, registrationId: retained.id, reason: 'duplicate', dedupeKey: `registration:${retained.id}:duplicate`,
      emailLogId: delivery.id,
    } });

    expect(event.registrationClosesAt.toISOString()).toBe('2026-09-10T22:30:00.000Z');
    expect(duplicate).toMatchObject({ status: 'DUPLICATE', duplicateOfRegistrationId: retained.id });
    expect(roster).toMatchObject({ reconstructed: true, revision: 1 });
    expect(audit.afterState).toEqual({ status: 'DUPLICATE', duplicateOfRegistrationId: retained.id });
    expect(await prisma.registration.count({ where: { eventId: event.id, ageFlagged: true } })).toBe(1);
    await expect(prisma.eventPolicySnapshot.delete({ where: { id: policy.id } })).rejects.toThrow();
    await expect(prisma.rosterSnapshot.create({ data: { eventId: event.id, revision: 1, data: [] } })).rejects.toThrow();
  });
});
