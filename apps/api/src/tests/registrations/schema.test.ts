import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('Registration persistence', () => {
  it('stores a registration with ranked positions and a null third choice', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const reg = await prisma.registration.create({
      data: {
        ...registrationFixture(event.id),
        rank1Position: 'GS',
        rank2Position: 'WA',
        rank3Position: null,
      },
    });
    expect(reg.status).toBe('PENDING');
    expect(reg.rank3Position).toBeNull();
  });
  it('rejects two active registrations for the same event, name, and date of birth', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await prisma.registration.create({ data: registrationFixture(event.id) });
    await expect(prisma.registration.create({ data: registrationFixture(event.id) })).rejects.toMatchObject({ code: 'P2002' });
  });
  it('allows a new registration once the earlier one is expired', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const first = await prisma.registration.create({ data: registrationFixture(event.id) });
    await prisma.registration.update({ where: { id: first.id }, data: { status: 'EXPIRED' } });
    await expect(prisma.registration.create({ data: registrationFixture(event.id) })).resolves.toBeTruthy();
  });
});

function eventFixture() {
  return {
    name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
    eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
    firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
    rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
  };
}

function registrationFixture(eventId: string) {
  return {
    eventId, playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
    dateOfBirth: new Date('2011-04-02T00:00:00.000Z'), parentName: 'Anne', parentEmail: 'anne@example.com',
    parentMobile: '0400000000', memberAssociation: 'MENA', rank1Position: 'GS' as const,
    eligibilityConfirmedAt: new Date('2026-08-01T00:00:00.000Z'),
    amountCents: 3500, policyReference: 'https://chisholmnetball.com/selection-policy/', expiresAt: new Date(Date.now() + 86_400_000),
  };
}
