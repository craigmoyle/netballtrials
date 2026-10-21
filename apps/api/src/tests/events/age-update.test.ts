import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { updateEvent } from '../../events/service';
import { EventValidationError } from '../../events/schemas';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(async () => {
  await resetDb();
  await prisma.memberAssociation.create({ data: { name: 'MENA' } });
});

describe('event age-setting changes', () => {
  it('recomputes outstanding registration age flags when bounds change', async () => {
    const event = await prisma.event.create({
      data: eventFixture({ competitionYear: 2026, minAge: 12, maxAge: 15 }),
    });
    const registration = await prisma.registration.create({
      data: registrationFixture(event.id, {
        status: 'PAID',
        dateOfBirth: new Date('2011-04-02T00:00:00Z'),
        ageFlagged: false,
      }),
    });

    await updateEvent(prisma, event.id, { minAge: 16, maxAge: 17 });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).ageFlagged).toBe(true);

    await updateEvent(prisma, event.id, { minAge: 12 });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).ageFlagged).toBe(false);
  });

  it('recomputes flags for many registrations in both directions', async () => {
    const event = await prisma.event.create({
      data: eventFixture({ competitionYear: 2026, minAge: 12, maxAge: 15 }),
    });
    const young = await prisma.registration.create({
      data: registrationFixture(event.id, { status: 'PAID', dateOfBirth: new Date('2013-04-02T00:00:00Z'), ageFlagged: false }),
    });
    const old = await prisma.registration.create({
      data: registrationFixture(event.id, { status: 'PENDING', dateOfBirth: new Date('2009-04-02T00:00:00Z'), ageFlagged: true }),
    });
    const withdrawn = await prisma.registration.create({
      data: registrationFixture(event.id, { status: 'WITHDRAWN', dateOfBirth: new Date('2013-04-02T00:00:00Z'), ageFlagged: false }),
    });

    await updateEvent(prisma, event.id, { minAge: 14, maxAge: 17 });
    const flags = async (id: string) => (await prisma.registration.findUniqueOrThrow({ where: { id } })).ageFlagged;
    expect(await flags(young.id)).toBe(true);
    expect(await flags(old.id)).toBe(false);
    expect(await flags(withdrawn.id)).toBe(false);
  });

  it('does not lose either of two concurrent edits to different fields', async () => {
    const event = await prisma.event.create({ data: eventFixture({ courts: 5, venue: 'SNC' }) });
    await Promise.all([
      updateEvent(prisma, event.id, { courts: 3 }),
      updateEvent(prisma, event.id, { venue: 'Waverley' }),
      updateEvent(prisma, event.id, { rank1Min: 1 }),
    ]);
    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.courts).toBe(3);
    expect(after.venue).toBe('Waverley');
    expect(after.rank1Min).toBe(1);
  });

  it('still reports validation errors and returns null for a missing event', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await expect(updateEvent(prisma, event.id, { minAge: 18, maxAge: 12 })).rejects.toBeInstanceOf(EventValidationError);
    expect(await updateEvent(prisma, 'missing-event', { courts: 3 })).toBeNull();
  });
});
