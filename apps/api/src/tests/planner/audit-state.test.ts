import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { seedEventWithPlayers } from '../helpers/planner';
import { generateDraftPlan, publishPlan, regenerateFromRound } from '../../planner/service';
import { saveManualRoundRevision } from '../../planner/games';
import type { PlanSlot } from '../../planner/types';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
const now = new Date('2027-09-12T01:00:00Z');
const load = (id: string) => prisma.roundPlan.findUniqueOrThrow({ where: { id }, include: { slots: true, players: true } });
const slots = (rows: Array<{ round: number; court: number; position: PlanSlot['position']; team: number; registrationId: string }>): PlanSlot[] => rows.map(({ round, court, position, team, registrationId }) => ({ round, court, position, team: team as 0 | 1, registrationId }));

async function published(count = 29, courts = 2, rank1Min = 1) {
  const event = await seedEventWithPlayers(count, { courts, rank1Min });
  if (count === 29) await prisma.registration.updateMany({ where: { eventId: event.id }, data: { optInExtraPositions: true } });
  const draft = await generateDraftPlan(prisma, event.id, 1);
  if (!draft.ok) throw new Error(JSON.stringify(draft));
  const result = await publishPlan(prisma, event.id, draft.plan.id);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { event, plan: await load(result.plan.id) };
}

it('blocks root generation and legacy root publication after publishing an early-leaver suffix', async () => {
  const { event, plan } = await published();
  const leaver = plan.slots.find((slot) => slot.round === 2)!.registrationId;
  const suffix = await regenerateFromRound(prisma, event.id, 2, now, plan.id, [leaver]);
  expect(suffix.ok, JSON.stringify(suffix)).toBe(true);
  if (!suffix.ok) return;
  expect((await publishPlan(prisma, event.id, suffix.plan.id)).ok).toBe(true);
  const count = await prisma.roundPlan.count();
  const root = await generateDraftPlan(prisma, event.id, 1);
  expect(root.ok).toBe(false);
  if (!root.ok) expect(root.gaps[0].message).toMatch(/regenerate.*remaining/i);
  expect(await prisma.roundPlan.count()).toBe(count);

  // Simulate an otherwise valid root draft saved by the old implementation.
  const { id, createdAt, publishedAt, slots: oldSlots, players, ...data } = plan;
  const legacy = await prisma.roundPlan.create({ data: {
    ...data, revision: 100, status: 'DRAFT', sourcePlanId: null,
    validationWarnings: [], slots: { create: slots(oldSlots) },
    players: { create: players.map(({ planId, ...player }) => player) },
  } });
  expect((await publishPlan(prisma, event.id, legacy.id)).ok).toBe(false);
  // A linked draft must also preserve the frozen boundary and inactivity, not just its source ID.
  await prisma.roundPlan.update({ where: { id: legacy.id }, data: { sourcePlanId: suffix.plan.id } });
  expect((await publishPlan(prisma, event.id, legacy.id)).ok).toBe(false);
  await prisma.roundPlan.update({ where: { id: legacy.id }, data: { frozenThroughRound: 1 } });
  expect((await publishPlan(prisma, event.id, legacy.id)).ok).toBe(false);
  expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).publishedPlanId).toBe(suffix.plan.id);
  const active = await load(suffix.plan.id);
  expect(active.players.find((player) => player.registrationId === leaver)?.active).toBe(false);
  expect(slots(active.slots.filter((slot) => slot.round === 1))).toEqual(slots(plan.slots.filter((slot) => slot.round === 1)));
});

it.each(['11:30', '09:18'])('refreshes a non-frozen published plan using the active roster minimum (last whistle %s)', async (lastWhistle) => {
  const { event, plan } = await published();
  const leaver = plan.players.find((player) => player.bibNumber === 29)!.registrationId;
  const suffix = await regenerateFromRound(prisma, event.id, 1, now, plan.id, [leaver]);
  if (!suffix.ok) throw new Error(JSON.stringify(suffix));
  expect((await publishPlan(prisma, event.id, suffix.plan.id)).ok).toBe(true);
  await prisma.event.update({ where: { id: event.id }, data: { lastWhistle } });
  const refreshed = await generateDraftPlan(prisma, event.id, 1);
  expect(refreshed.ok, JSON.stringify(refreshed)).toBe(true);
  if (!refreshed.ok) return;
  const next = await load(refreshed.plan.id);
  expect(next.sourcePlanId).toBe(suffix.plan.id);
  expect(next.rounds).toBe(2);
  expect(next.players).toHaveLength(29);
  expect(next.players.filter((player) => player.active)).toHaveLength(28);
  expect(next.players.find((player) => player.registrationId === leaver)?.active).toBe(false);
  expect(next.slots.some((slot) => slot.registrationId === leaver)).toBe(false);
  expect((await publishPlan(prisma, event.id, next.id)).ok).toBe(true);
});

it.each(['settings', 'roster', 'published revision'] as const)('revalidates %s at the full-generation save lock', async (change) => {
  const { event, plan } = await published();
  const originalTransaction = prisma.$transaction.bind(prisma);
  vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (callback: any) => {
    if (change === 'settings') await prisma.event.update({ where: { id: event.id }, data: { venue: 'Changed venue' } });
    if (change === 'roster') await prisma.registration.update({ where: { id: plan.players[0].registrationId }, data: { playerFirstName: 'Changed' } });
    if (change === 'published revision') {
      await saveManualRoundRevision(prisma, event.id, 1, { sourcePlanId: plan.id, slots: slots(plan.slots.filter((slot) => slot.round === 1)), overrideWarnings: true }, now);
    }
    return originalTransaction(callback);
  }) as typeof prisma.$transaction);
  const result = await generateDraftPlan(prisma, event.id, 1);
  expect(result.ok).toBe(false);
  expect(await prisma.roundPlan.count({ where: { eventId: event.id, status: 'DRAFT' } })).toBe(0);
});

it.each([false, true])('retains only approved, unchanged frozen preference exceptions through regenerate and publish (legacy warnings: %s)', async (legacy) => {
  const { event, plan } = await published(14, 1, 2);
  const round = slots(plan.slots.filter((slot) => slot.round === 1));
  const a = round.find((slot) => slot.position === 'GS')!;
  const b = round.find((slot) => slot.position === 'GA')!;
  [a.registrationId, b.registrationId] = [b.registrationId, a.registrationId];
  const input = { sourcePlanId: plan.id, slots: round, overrideWarnings: false };
  expect(await saveManualRoundRevision(prisma, event.id, 1, input, now)).toMatchObject({ ok: false, reason: 'warnings_required' });
  const manual = await saveManualRoundRevision(prisma, event.id, 1, { ...input, overrideWarnings: true }, now);
  if (!manual.ok) throw new Error(JSON.stringify(manual));
  if (legacy) await prisma.roundPlan.update({ where: { id: manual.plan.id }, data: { validationWarnings: [a, b].map((slot) => ({
    code: 'position_preference_warning', message: 'Approved historical preference exception',
    detail: { registrationId: slot.registrationId, position: slot.position },
  })) } });
  const rebuilt = await regenerateFromRound(prisma, event.id, 2, now, manual.plan.id);
  expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
  if (!rebuilt.ok) return;
  const next = await load(rebuilt.plan.id);
  expect(next.validationWarnings).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'position_preference_warning', detail: expect.objectContaining(a) }),
    expect.objectContaining({ code: 'position_preference_warning', detail: expect.objectContaining(b) }),
  ]));
  expect((await publishPlan(prisma, event.id, next.id)).ok).toBe(true);
  expect((await load(next.id)).validationWarnings).toEqual(next.validationWarnings);

  const again = await regenerateFromRound(prisma, event.id, 2, now, next.id);
  expect(again.ok, JSON.stringify(again)).toBe(true);
  if (!again.ok) return;
  const tampered = await load(again.plan.id);
  const suffixA = tampered.slots.find((slot) => slot.round === 2 && slot.registrationId === a.registrationId)!;
  const suffixB = tampered.slots.find((slot) => slot.round === 2 && slot.registrationId === b.registrationId)!;
  await prisma.roundSlot.deleteMany({ where: { id: { in: [suffixA.id, suffixB.id] } } });
  await prisma.roundSlot.createMany({ data: [{ ...suffixA, registrationId: b.registrationId }, { ...suffixB, registrationId: a.registrationId }] });
  expect((await publishPlan(prisma, event.id, again.plan.id)).ok).toBe(false);
});

it('does not grandfather an unapproved frozen preference violation', async () => {
  const { event, plan } = await published(14, 1, 2);
  const a = plan.slots.find((slot) => slot.round === 1 && slot.position === 'GS')!;
  const b = plan.slots.find((slot) => slot.round === 1 && slot.position === 'GA')!;
  await prisma.roundSlot.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await prisma.roundSlot.createMany({ data: [{ ...a, registrationId: b.registrationId }, { ...b, registrationId: a.registrationId }] });
  expect((await regenerateFromRound(prisma, event.id, 2, now, plan.id)).ok).toBe(false);
});
