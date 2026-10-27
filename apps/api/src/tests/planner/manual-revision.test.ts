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

async function saveSuffix(input: Record<string, unknown>) {
  return app.inject({
    method: 'POST', url: `/api/admin/events/${eventId}/plan/suffix/manual`,
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
  const draft = await generateDraftPlan(prisma, event.id, 7);
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

  it('blocks edits to a frozen round and future assignments for withdrawn players', async () => {
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
    const frozenEdit = await saveRound(1, planInput(edited));
    expect(frozenEdit.statusCode).toBe(422);
    expect(frozenEdit.json()).toMatchObject({ error: 'invalid_plan' });
    expect(frozenEdit.json().errors[0].message).toContain('frozen round 1');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(source.id);

    const future = source.slots.filter((slot) => slot.round === 2).map(slotInput);
    future[0] = { ...future[0], registrationId: withdrawnSlot.registrationId };
    const rejected = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/plan/rounds/2/manual`,
      cookies: { nt_session: adminCookie }, payload: { sourcePlanId: source.id, slots: future, overrideWarnings: false },
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

  it('saves a complete manual suffix, preserves the prefix and leaves registration history unchanged', async () => {
    await resetDb();
    adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
    await createPublishedEvent(29, true);
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true, players: true } });
    const fromRound = 2;
    const removed = source.players.find((player) => source.slots.some((slot) => slot.round === 1 && slot.registrationId === player.registrationId) &&
      source.slots.some((slot) => slot.round >= fromRound && slot.registrationId === player.registrationId))!;
    const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: removed.registrationId } });
    const prefix = source.slots.filter((slot) => slot.round < fromRound).map(slotInput);
    const suffix = source.slots.filter((slot) => slot.round >= fromRound).map(slotInput);
    for (let round = fromRound; round <= source.rounds; round += 1) {
      const leaverSlot = suffix.find((slot) => slot.round === round && slot.registrationId === removed.registrationId);
      if (!leaverSlot) continue;
      const assigned = new Set(suffix.filter((slot) => slot.round === round).map((slot) => slot.registrationId));
      const replacement = source.players.find((player) => player.active && player.registrationId !== removed.registrationId && !assigned.has(player.registrationId));
      expect(replacement).toBeTruthy();
      const index = suffix.findIndex((slot) => slot === leaverSlot);
      suffix[index] = { ...leaverSlot, registrationId: replacement!.registrationId };
    }

    const response = await saveSuffix({ sourcePlanId: source.id, fromRound, slots: suffix, removedRegistrationIds: [removed.registrationId], overrideWarnings: true });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ status: 'PUBLISHED', revision: source.revision + 1, sourcePlanId: source.id, frozenThroughRound: fromRound - 1 });
    const next = await prisma.roundPlan.findUniqueOrThrow({ where: { id: response.json().id }, include: { slots: true, players: true } });
    expect(sortedSlots(next.slots.filter((slot) => slot.round < fromRound).map(slotInput))).toEqual(sortedSlots(prefix));
    expect(next.slots.some((slot) => slot.round >= fromRound && slot.registrationId === removed.registrationId)).toBe(false);
    expect(next.players.find((player) => player.registrationId === removed.registrationId)?.active).toBe(false);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(next.id);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: removed.registrationId } })).toMatchObject({
      status: registrationBefore.status, bibNumber: registrationBefore.bibNumber, checkedInAt: registrationBefore.checkedInAt,
    });
  });

  it('blocks an incomplete manual suffix without creating a revision', async () => {
    await resetDb();
    adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
    await createPublishedEvent();
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const suffix = source.slots.filter((slot) => slot.round >= 2).map(slotInput);
    const countBefore = await prisma.roundPlan.count({ where: { eventId } });

    const response = await saveSuffix({ sourcePlanId: source.id, fromRound: 2, slots: suffix.slice(0, -1), removedRegistrationIds: [], overrideWarnings: false });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'invalid_plan' });
    expect(await prisma.roundPlan.count({ where: { eventId } })).toBe(countBefore);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(source.id);
  });

  it('requires a warning override for soft manual suffix violations', async () => {
    await resetDb();
    adminCookie = await signInAsNewAdmin(app, 'manual-plan-admin@example.com');
    await createPublishedEvent(29);
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true, players: true } });
    const suffix = source.slots.filter((slot) => slot.round >= 2).map(slotInput);
    const roundTwo = suffix.filter((slot) => slot.round === 2);
    const assigned = new Set(roundTwo.map((slot) => slot.registrationId));
    const resting = source.players.find((player) => player.active && !assigned.has(player.registrationId))!;
    const position = roundTwo.find((slot) => slot.position !== resting.rank1Position)!;
    const edited = suffix.map((slot) => slot === position ? { ...slot, registrationId: resting.registrationId } : slot);
    const beforeCount = await prisma.roundPlan.count({ where: { eventId } });
    const input = { sourcePlanId: source.id, fromRound: 2, slots: edited, removedRegistrationIds: [], overrideWarnings: false };

    const warning = await saveSuffix(input);
    expect(warning.statusCode).toBe(422);
    expect(warning.json()).toMatchObject({ error: 'warnings_require_confirmation' });
    expect(warning.json().warnings.length).toBeGreaterThan(0);
    expect(await prisma.roundPlan.count({ where: { eventId } })).toBe(beforeCount);

    const accepted = await saveSuffix({ ...input, overrideWarnings: true });
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

  it('does not publish a regenerated draft after a newer manual revision supersedes its source', async () => {
    const rebuilt = await regenerateFromRound(prisma, eventId, 2, new Date(), activePlanId);
    expect(rebuilt.ok, JSON.stringify(rebuilt)).toBe(true);
    if (!rebuilt.ok) return;
    const source = await prisma.roundPlan.findUniqueOrThrow({ where: { id: activePlanId }, include: { slots: true } });
    const manual = await saveRound(1, planInput(source.slots.filter((slot) => slot.round === 1).map(slotInput)));
    expect(manual.statusCode, manual.body).toBe(201);
    const newerId = manual.json().id;

    const current = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan`, cookies: { nt_session: adminCookie } });
    expect(current.json().id).toBe(newerId);

    const fallback = await publishPlan(prisma, eventId);
    expect(fallback.ok).toBe(false);
    if (!fallback.ok) expect(fallback.gaps[0].message).toMatch(/newer revision/i);
    const explicit = await publishPlan(prisma, eventId, rebuilt.plan.id);
    expect(explicit.ok).toBe(false);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).publishedPlanId).toBe(newerId);
    expect((await prisma.roundPlan.findUniqueOrThrow({ where: { id: rebuilt.plan.id } })).status).toBe('DRAFT');
  });
});
