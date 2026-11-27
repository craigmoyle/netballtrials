import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';
import { createPendingRegistration, RegistrationConflictError, RegistrationIneligibleError, RegistrationValidationError } from '../../registrations/service';

let eventId: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture({ eventDate: new Date('2099-09-12T00:00:00.000Z') }), status: 'OPEN' } });
  eventId = event.id;
  await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });
});

const input = {
  playerFirstName: 'Ada', playerLastName: 'Lovelace', dateOfBirth: '2012-04-02',
  parentName: 'Anne', parentEmail: 'anne@example.com', parentMobile: '0400000000',
  memberAssociation: 'MENA', rank1Position: 'GS' as const, optInExtraPositions: false, parentAuthorityConfirmed: true as const, eligibilityConfirmed: true as const,
};

describe('createPendingRegistration', () => {
  it('rejects an out-of-range age before creating a registration', async () => {
    await expect(createPendingRegistration(prisma, eventId, { ...input, dateOfBirth: '2018-04-02' }, new Date()))
      .rejects.toBeInstanceOf(RegistrationIneligibleError);
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
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
  it('does not create a second public registration after the previous pending one expires', async () => {
    const first = await createPendingRegistration(prisma, eventId, input, new Date());
    await prisma.registration.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(createPendingRegistration(prisma, eventId, input, new Date()))
      .rejects.toMatchObject({ reason: 'duplicate', existing: expect.objectContaining({ id: first.id }) });

    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'PENDING' });
  });
  it('records the immutable snapshot URL on a new registration', async () => {
    const registration = await createPendingRegistration(prisma, eventId, input, new Date(), 'http://api.test');

    expect(registration.policyReference).toBe(`http://api.test/api/public/events/${eventId}/policy-snapshots/1`);
  });

  it('accepts today as a calendar date and then applies strict eligibility', async () => {
    await expect(createPendingRegistration(prisma, eventId, { ...input, dateOfBirth: '2026-10-10' }, new Date('2026-10-09T14:00:00Z')))
      .rejects.toBeInstanceOf(RegistrationIneligibleError);
  });

  it('rejects a date of birth in the future', async () => {
    await expect(
      createPendingRegistration(prisma, eventId, { ...input, dateOfBirth: '2026-10-11' }, new Date('2026-10-10T00:00:00Z')),
    ).rejects.toMatchObject({ fields: ['dateOfBirth'] });
  });
  it('requires an active member association', async () => {
    await expect(createPendingRegistration(prisma, eventId, { ...input, memberAssociation: 'Unknown Club' }, new Date()))
      .rejects.toBeInstanceOf(RegistrationValidationError);
    await prisma.memberAssociation.update({ where: { name: 'MENA' }, data: { active: false } });
    await expect(createPendingRegistration(prisma, eventId, input, new Date()))
      .rejects.toBeInstanceOf(RegistrationValidationError);
  });
  it('refuses when the event is not open', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: 'DRAFT' } });
    await expect(createPendingRegistration(prisma, eventId, input, new Date())).rejects.toMatchObject({ reason: 'closed' });
  });
});
