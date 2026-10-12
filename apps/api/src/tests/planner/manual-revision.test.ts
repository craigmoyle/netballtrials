import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { registrationFixture } from '../helpers/fixtures';
import { seedEventWithPlayers } from '../helpers/planner';
import { generateDraftPlan, publishPlan, regenerateFromRound } from '../../planner/service';
import { withdrawRegistration } from '../../registrations/service';

const app = createApp();
let adminCookie: string;
let eventId: string;
let activePlanId: string;
let activeRevision: number;

function planInput(slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }>, overrideWarnings = false) {
  return { sourcePlanId: activePlanId, slots, overrideWarnings };
}

async function saveRound(round: number, input: Record<string, unknown>) {
  return app.inject({
    method: 'POST', url: `/api/admin/events/${eventId}/plan/rounds/${round}/manual`,
    cookies: { nt_session: adminCookie }, payload: input,
  });
}

function slotInput(slot: { round: number; court: number; position: string; team: number; registrationId: string }) {
  return { round: slot.round, court: slot.court, position: slot.position, team: slot.team, registrationId: slot.registrationId };
}

function sortedSlots(slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }>) {
  return [...slots].sort((a, b) => a.round - b.round || a.court - b.court || a.position.localeCompare(b.position) || a.team - b.team)
    .map(({ round, court, position, team, registrationId }) => ({ round, court, position, team, registrationId }));
}

async function createPublishedEvent(players = 28, optInExtra = false) {
  const event = await seedEventWithPlayers(players, { courts: 2, checkedIn: players, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
  if (optInExtra) await prisma.registration.updateMany({ where: { eventId: event.id }, data: { optInExtraPositions: true } });
  const draft = await generateDraftPlan(prisma, event.id, new Date(), 7);
  if (!draft.ok) throw new Error(`manual revision fixture is infeasible: ${draft.gaps.map((gap) => gap.message).join('; ')}`);
  const published = await publishPlan(prisma, event.id, draft.plan.id);
  if (!published.ok) throw new Error('manual revision fixture did not publish');
  eventId = event.id;
  activePlanId = published.plan.id;
  activeRevision = published.plan.revision;
}

beforeEach(async () => {
  await resetDb();
  adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
  await createPublishedEvent();
});

describe('manual published-plan revisions', () => {
  it('swaps two players in one round without mutating the source revision', async () => {
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const sourceSlots = source.slots.map(slotInput);
    const roundSlots = sourceSlots.filter((slot) => slot.round === 1);
    const first = roundSlots.find((slot) => slot.court === 1 && slot.position === 'GS' && slot.team === 0)!;
    const second = roundSlots.find((slot) => slot.court === 1 && slot.position === 'GS' && slot.team === 1)!;
    const submitted = roundSlots.map((slot) => slot.registrationId === first.registrationId
      ? { ...slot, registrationId: second.registrationId }
      : slot.registrationId === second.registrationId ? { ...slot, registrationId: first.registrationId } : slot);

    const response = await saveRound(1, planInput(submitted));

    expect(response.statusCode, response.body).toBe(201);
    const next = response.json();
    expect(next).toMatchObject({ status: 'PUBLISHED', revision: activeRevision + 1, sourcePlanId: activePlanId });
    expect(next.slots.find((slot: { round: number; court: number; position: string; team: number }) => slot.round === 1 && slot.court === 1 && slot.position === 'GS' && slot.team === 0).registrationId).toBe(second.registrationId);
    expect(next.slots.find((slot: { round: number; court: number; position: string; team: number }) => slot.round === 1 && slot.court === 1 && slot.position === 'GS' && slot.team === 1).registrationId).toBe(first.registrationId);
    expect(sortedSlots(next.slots.filter((slot: { round: number }) => slot.round !== 1))).toEqual(sortedSlots(sourceSlots.filter((slot) => slot.round !== 1)));
    expect(sortedSlots((await prisma.roundSlot.findMany({ where: { planId: activePlanId } })).map(slotInput))).toEqual(sortedSlots(sourceSlots));
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(next.id);
  });

  it('substitutes a resting player while preserving full structure', async () => {
    await resetDb();
    adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
    await createPublishedEvent(29);
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true, players: true } });
    const sourceSlots = source.slots.map(slotInput);
    const roundSlots = sourceSlots.filter((slot) => slot.round === 1);
    const assigned = new Set(roundSlots.map((slot) => slot.registrationId));
    const resting = source.players.find((player) => player.active && !assigned.has(player.registrationId));
    expect(resting).toBeTruthy();
    const displaced = roundSlots[0];
    const submitted = roundSlots.map((slot) => slot === displaced ? { ...slot, registrationId: resting!.registrationId } : slot);

    const response = await saveRound(1, planInput(submitted, true));

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().slots).toContainEqual(expect.objectContaining({ round: 1, registrationId: resting!.registrationId }));
    expect(response.json().slots).not.toContainEqual(expect.objectContaining({ round: 1, registrationId: displaced.registrationId }));
  });

  it('allows an unchanged withdrawn player in a completed slot but blocks a future assignment', async () => {
    await resetDb();
    adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
    await createPublishedEvent(29, true);
    const originalId = activePlanId;
    const original = await prisma.roundPlan.findUniqueOrThrow({ where: { id: originalId }, include: { slots: true } });
    const withdrawnSlot = original.slots.find((slot) => slot.round === 1)!;
    await withdrawRegistration(prisma, eventId, withdrawnSlot.registrationId, new Date());

    const rebuilt = await regenerateFromRound(prisma, eventId, 2, new Date(), originalId);
    expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
    if (!rebuilt.ok) return;
    const published = await publishPlan(prisma, eventId, rebuilt.plan.id);
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    activePlanId = published.plan.id;
    activeRevision = published.plan.revision;
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    expect(source.frozenThroughRound).toBe(1);
    expect(source.slots).toContainEqual(expect.objectContaining({ round: 1, registrationId: withdrawnSlot.registrationId }));
    expect(source.slots.some((slot) => slot.round > 1 && slot.registrationId === withdrawnSlot.registrationId)).toBe(false);

    const completed = source.slots.filter((slot) => slot.round === 1).map(slotInput);
    const first = completed.find((slot) => slot.court === 1 && slot.team === 0 && slot.registrationId !== withdrawnSlot.registrationId &&
      completed.some((other) => other.court === slot.court && other.position === slot.position && other.team === 1 && other.registrationId !== withdrawnSlot.registrationId))!;
    const second = completed.find((slot) => slot.court === first.court && slot.position === first.position && slot.team === 1 && slot.registrationId !== withdrawnSlot.registrationId)!;
    const edited = completed.map((slot) => slot.registrationId === first.registrationId
      ? { ...slot, registrationId: second.registrationId }
      : slot.registrationId === second.registrationId ? { ...slot, registrationId: first.registrationId } : slot);
    const saved = await saveRound(1, planInput(edited));
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().slots).toContainEqual(expect.objectContaining({ round: 1, registrationId: withdrawnSlot.registrationId }));
    expect(saved.json().slots).not.toContainEqual(expect.objectContaining({ round: 2, registrationId: withdrawnSlot.registrationId }));

    const future = saved.json().slots.filter((slot: { round: number }) => slot.round === 2).map(slotInput);
    future[0] = { ...future[0], registrationId: withdrawnSlot.registrationId };
    const rejected = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/plan/rounds/2/manual`,
      cookies: { nt_session: adminCookie }, payload: { sourcePlanId: saved.json().id, slots: future, overrideWarnings: false },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ error: 'invalid_plan' });
  });

  it('blocks an unfilled court position and leaves the active plan unchanged', async () => {
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const roundSlots = source.slots.filter((slot) => slot.round === 1).map(slotInput);
    const beforeCount = await prisma.roundPlan.count({ where: { eventId } });
    const response = await saveRound(1, planInput(roundSlots.slice(0, -1)));

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('invalid_plan');
    expect(await prisma.roundPlan.count({ where: { eventId } })).toBe(beforeCount);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(activePlanId);
  });

  it('blocks a player appearing twice in the selected round', async () => {
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const roundSlots = source.slots.filter((slot) => slot.round === 1).map(slotInput);
    roundSlots[1] = { ...roundSlots[1], registrationId: roundSlots[0].registrationId };
    const response = await saveRound(1, planInput(roundSlots));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'invalid_plan' });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(activePlanId);
  });

  it('blocks a new assignment for a pending player', async () => {
    const pending = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Waiting', playerLastName: 'Player', playerNameNormalized: 'waiting player', status: 'PENDING',
      checkedInAt: null, bibNumber: null,
    }) });
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const roundSlots = source.slots.filter((slot) => slot.round === 1).map(slotInput);
    roundSlots[0] = { ...roundSlots[0], registrationId: pending.id };
    const response = await saveRound(1, planInput(roundSlots));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'invalid_plan' });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');
  });

  it('returns soft warnings without writing, then retains them when explicitly overridden', async () => {
    await resetDb();
    adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
    await createPublishedEvent(29);
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true, players: true } });
    const roundSlots = source.slots.filter((slot) => slot.round === 1).map(slotInput);
    const assigned = new Set(roundSlots.map((slot) => slot.registrationId));
    const resting = source.players.find((player) => player.active && !assigned.has(player.registrationId))!;
    const rank1 = resting.rank1Position;
    const outOfChoiceSlot = roundSlots.find((slot) => slot.position !== rank1)!;
    const submitted = roundSlots.map((slot) => slot === outOfChoiceSlot ? { ...slot, registrationId: resting.registrationId } : slot);
    const beforeCount = await prisma.roundPlan.count({ where: { eventId } });

    const warning = await saveRound(1, planInput(submitted));
    expect(warning.statusCode).toBe(422);
    expect(warning.json()).toMatchObject({ error: 'warnings_require_confirmation' });
    expect(warning.json().warnings.length).toBeGreaterThan(0);
    expect(await prisma.roundPlan.count({ where: { eventId } })).toBe(beforeCount);

    const accepted = await saveRound(1, planInput(submitted, true));
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().validationWarnings.length).toBeGreaterThan(0);
  });

  it('rejects a stale source revision and leaves the newer active revision in place', async () => {
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const roundSlots = source.slots.filter((slot) => slot.round === 1).map(slotInput);
    const first = await saveRound(1, planInput(roundSlots));
    expect(first.statusCode).toBe(201);
    const stale = await saveRound(1, planInput(roundSlots));
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'stale_plan' });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(first.json().id);
  });
});
