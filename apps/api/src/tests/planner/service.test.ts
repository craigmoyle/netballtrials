import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { generateDraftPlan, publishPlan, regenerateFromRound } from '../../planner/service';
import { seedEventWithPlayers } from '../helpers/planner';

beforeEach(resetDb);

describe('plan service', () => {
  it('generates a draft from checked-in players only', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const result = await generateDraftPlan(prisma, event.id, new Date(), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe('DRAFT');
    expect(await prisma.roundSlot.count({ where: { planId: result.plan.id } })).toBe(2 * 2 * 14);
  });
  it('does not save a plan when a check-in gap exists', async () => {
    const event = await seedEventWithPlayers(20, { courts: 2, checkedIn: 20 });
    const result = await generateDraftPlan(prisma, event.id, new Date(), 1);
    expect(result.ok).toBe(false);
    expect(await prisma.roundPlan.count()).toBe(0);
  });
  it('keeps played rounds fixed when regenerating from round 2', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const first = await generateDraftPlan(prisma, event.id, new Date(), 1);
    if (!first.ok) throw new Error('setup failed');
    await publishPlan(prisma, event.id);
    const before = await prisma.roundSlot.findMany({
      where: { planId: first.plan.id, round: 1 },
      orderBy: { id: 'asc' },
    });
    const regen = await regenerateFromRound(prisma, event.id, 2, new Date());
    expect(regen.ok).toBe(true);
    const after = await prisma.roundSlot.findMany({ where: { round: 1 }, orderBy: { id: 'asc' } });
    expect(after.map((slot) => slot.registrationId)).toEqual(
      before.map((slot) => slot.registrationId),
    );
  });
});
