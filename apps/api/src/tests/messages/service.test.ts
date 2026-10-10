import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createDevMailer } from '../../mail/dev-mailer';
import { sendEventMessage } from '../../messages/service';
import { eventFixture } from '../helpers/fixtures';
import { seedPaidFlagged } from '../helpers/review';

beforeEach(resetDb);

describe('sendEventMessage', () => {
  it('sends to paid registrations, records a log, and skips withdrawn players', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const paid = await seedPaidFlagged(event.id);
    const withdrawn = await prisma.registration.create({
      data: {
        eventId: event.id,
        playerFirstName: 'Bea',
        playerLastName: 'Ng',
        playerNameNormalized: 'bea ng',
        dateOfBirth: new Date('2011-05-05T00:00:00Z'),
        parentName: 'Bo',
        parentEmail: 'bo@example.com',
        parentMobile: '0400000001',
        memberAssociation: 'MENA',
        rank1Position: 'GK',
        eligibilityConfirmedAt: new Date('2026-08-01T00:00:00Z'),
        amountCents: 3500,
        policyReference: 'x',
        expiresAt: new Date(Date.now() + 86_400_000),
        status: 'WITHDRAWN',
      },
    });
    const mailer = createDevMailer([]);
    const result = await sendEventMessage(
      { prisma, mailer },
      event.id,
      { subject: 'Venue change', text: 'New court' },
      new Date(),
    );
    expect(result.sent).toBe(1);
    expect(mailer.sent.map((message) => message.to)).toEqual(['anne@example.com']);
    expect(await prisma.emailLog.count({ where: { eventId: event.id, kind: 'message' } })).toBe(1);
    expect(paid.id).toBeTruthy();
    expect(withdrawn.id).toBeTruthy();
  });
  it('records a delivery failure without losing the log', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await seedPaidFlagged(event.id);
    const mailer = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const result = await sendEventMessage(
      { prisma, mailer },
      event.id,
      { subject: 'x', text: 'y' },
      new Date(),
    );
    expect(result.failed).toBe(1);
    expect((await prisma.emailLog.findFirst())?.failedAt).not.toBeNull();
  });
});
