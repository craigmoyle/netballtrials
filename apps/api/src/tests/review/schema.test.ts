import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('review and email log schema', () => {
  it('stores a review item and an email log for a registration', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const reg = await prisma.registration.create({
      data: {
        eventId: event.id,
        playerFirstName: 'Ada',
        playerLastName: 'Lovelace',
        playerNameNormalized: 'ada lovelace',
        dateOfBirth: new Date('2018-04-02T00:00:00Z'),
        parentName: 'Anne',
        parentEmail: 'anne@example.com',
        parentMobile: '0400000000',
        memberAssociation: 'MENA',
        rank1Position: 'GS',
        eligibilityConfirmedAt: new Date('2026-08-01T00:00:00Z'),
        amountCents: 3500,
        policyReference: 'x',
        expiresAt: new Date(Date.now() + 86_400_000),
        ageFlagged: true,
        status: 'PAID',
      },
    });
    const item = await prisma.reviewItem.create({
      data: { eventId: event.id, registrationId: reg.id, reason: 'age_out_of_range' },
    });
    const log = await prisma.emailLog.create({
      data: {
        eventId: event.id,
        registrationId: reg.id,
        to: 'anne@example.com',
        subject: 'Reminder',
        kind: 'reminder',
        body: 'Tomorrow',
      },
    });
    expect(item.reason).toBe('age_out_of_range');
    expect(log.kind).toBe('reminder');
  });
});
