import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';

beforeEach(resetDb);

describe('round slot database constraints', () => {
  it('rejects filling one court place twice in the same plan round', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const plan = await prisma.roundPlan.create({
      data: { eventId: event.id, seed: 1, rounds: 1, playMinutes: 8, changeoverMinutes: 2 },
    });
    await prisma.roundSlot.create({
      data: { planId: plan.id, round: 1, court: 1, position: 'GS', team: 0, registrationId: 'r1' },
    });
    await expect(prisma.roundSlot.create({
      data: { planId: plan.id, round: 1, court: 1, position: 'GS', team: 0, registrationId: 'r2' },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects assigning one registration twice in a round', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const plan = await prisma.roundPlan.create({
      data: { eventId: event.id, seed: 1, rounds: 1, playMinutes: 8, changeoverMinutes: 2 },
    });
    await prisma.roundSlot.create({
      data: { planId: plan.id, round: 1, court: 1, position: 'GS', team: 0, registrationId: 'r1' },
    });
    await expect(prisma.roundSlot.create({
      data: { planId: plan.id, round: 1, court: 1, position: 'GA', team: 0, registrationId: 'r1' },
    })).rejects.toMatchObject({ code: 'P2002' });
  });
});
