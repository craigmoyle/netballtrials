import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createPendingRegistration, expireStalePending, RegistrationConflictError } from '../../registrations/service';

let eventId: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  eventId = event.id;
});

const input = {
  playerFirstName: 'Ada', playerLastName: 'Lovelace', dateOfBirth: '2011-04-02',
  parentName: 'Anne', parentEmail: 'anne@example.com', parentMobile: '0400000000',
  memberAssociation: 'MENA', rank1Position: 'GS' as const, optInExtraPositions: false, eligibilityConfirmed: true as const,
};

describe('createPendingRegistration', () => {
  it('flags an out-of-range age without rejecting', async () => {
    const reg = await createPendingRegistration(prisma, eventId, { ...input, dateOfBirth: '2018-04-02' }, new Date());
    expect(reg.ageFlagged).toBe(true);
    expect(reg.status).toBe('PENDING');
  });
  it('refuses a duplicate unexpired pending registration', async () => {
    await createPendingRegistration(prisma, eventId, input, new Date());
    await expect(createPendingRegistration(prisma, eventId, input, new Date())).rejects.toBeInstanceOf(RegistrationConflictError);
  });
  it('treats a differently cased and accented name as the same player', async () => {
    await createPendingRegistration(prisma, eventId, { ...input, playerLastName: 'Lovelace' }, new Date());
    await expect(
      createPendingRegistration(prisma, eventId, { ...input, playerFirstName: '  ADA ', playerLastName: 'lovelace' }, new Date()),
    ).rejects.toBeInstanceOf(RegistrationConflictError);
  });
  it('survives two simultaneous submissions with one winner', async () => {
    const results = await Promise.allSettled([
      createPendingRegistration(prisma, eventId, input, new Date()),
      createPendingRegistration(prisma, eventId, input, new Date()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('allows a new registration after the previous pending one expires', async () => {
    const first = await createPendingRegistration(prisma, eventId, input, new Date());
    await prisma.registration.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireStalePending(prisma, eventId, new Date())).toBe(1);
    await expect(createPendingRegistration(prisma, eventId, input, new Date())).resolves.toBeTruthy();
  });
  it('refuses when the event is not open', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: 'DRAFT' } });
    await expect(createPendingRegistration(prisma, eventId, input, new Date())).rejects.toMatchObject({ reason: 'closed' });
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
