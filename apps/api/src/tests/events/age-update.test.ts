import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { updateEvent } from '../../events/service';
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
});
