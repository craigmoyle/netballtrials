import { Prisma, type PrismaClient, type RoundPlan } from '@prisma/client';
import { computeMinimumRounds, totalTimeMinutes } from './minimum';
import { runGeneration } from './worker';
import { verifyPlan } from './verify';
import { frozenExceptions, slotKey } from './frozen-exceptions';
import type { PlannerGap, PlannerInput, PlannerPlayer, PlannerPlan, PlanSlot } from './types';

type Database = PrismaClient | Prisma.TransactionClient;
type BuiltInput = { event: Prisma.EventGetPayload<{}>; input: PlannerInput };
export type GenerateResult = { ok: true; plan: RoundPlan } | { ok: false; gaps: PlannerGap[] };

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function eventWindowMinutes(event: { firstWhistle: string; lastWhistle: string }): number {
  return Math.max(1, toMinutes(event.lastWhistle) - toMinutes(event.firstWhistle));
}

export async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
  return rows.length === 1;
}

// True when a plan snapshot was built from the event's current settings.
export function settingsMatch(snapshot: RoundPlan, event: Prisma.EventGetPayload<{}>): boolean {
  return snapshot.eventId === event.id && snapshot.eventName === event.name &&
    snapshot.eventDate.toISOString().slice(0, 10) === event.eventDate.toISOString().slice(0, 10) &&
    snapshot.venue === event.venue && snapshot.firstWhistle === event.firstWhistle &&
    snapshot.courts === event.courts && snapshot.playMinutes === event.playMinutes &&
    snapshot.changeoverMinutes === event.changeoverMinutes && snapshot.windowMinutes === eventWindowMinutes(event) &&
    snapshot.rank1Min === event.rank1Min && snapshot.rank2Min === event.rank2Min && snapshot.rank3Min === event.rank3Min;
}

async function buildInput(prisma: Database, eventId: string): Promise<BuiltInput | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;

  const registrations = await prisma.registration.findMany({
    where: { eventId, status: 'PAID', checkedInAt: { not: null } },
    orderBy: { bibNumber: 'asc' },
  });
  const players: PlannerPlayer[] = registrations.map((registration) => ({
    registrationId: registration.id,
    name: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    bibNumber: registration.bibNumber ?? 0,
    rank1: registration.rank1Position,
    rank2: registration.rank2Position,
    rank3: registration.rank3Position,
    optInExtra: registration.optInExtraPositions,
  }));
  const windowMinutes = eventWindowMinutes(event);
  const input = {
    courts: event.courts,
    rounds: 1,
    playMinutes: event.playMinutes,
    changeoverMinutes: event.changeoverMinutes,
    windowMinutes,
    rank1Min: event.rank1Min,
    rank2Min: event.rank2Min,
    rank3Min: event.rank3Min,
    players,
  } satisfies PlannerInput;
  input.rounds = computeMinimumRounds(input);
  return { event, input };
}

export async function getPlanPreview(
  prisma: PrismaClient,
  eventId: string,
): Promise<{ checkedInPlayers: number; minimumRounds: number; requiredMinutes: number; windowMinutes: number; fitsTimeWindow: boolean } | null> {
  const built = await buildInput(prisma, eventId);
  if (!built) return null;
  const minimumRounds = computeMinimumRounds(built.input);
  const requiredMinutes = totalTimeMinutes(minimumRounds, built.input.playMinutes, built.input.changeoverMinutes);
  return {
    checkedInPlayers: built.input.players.length,
    minimumRounds,
    requiredMinutes,
    windowMinutes: built.input.windowMinutes,
    fitsTimeWindow: requiredMinutes <= built.input.windowMinutes,
  };
}

function planSlots(plan: PlannerPlan) {
  return plan.slots.map((slot) => ({
    round: slot.round,
    court: slot.court,
    position: slot.position,
    team: slot.team,
    registrationId: slot.registrationId,
  }));
}

function playerSnapshots(input: PlannerInput) {
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  return input.players.map((player) => ({
    registrationId: player.registrationId,
    playerName: player.name,
    bibNumber: player.bibNumber || null,
    rank1Position: player.rank1,
    rank2Position: player.rank2,
    rank3Position: player.rank3,
    optInExtraPositions: player.optInExtra,
    active: !inactive.has(player.registrationId),
  }));
}

function inputFromSnapshot(plan: {
  courts: number;
  rounds: number;
  playMinutes: number;
  changeoverMinutes: number;
  windowMinutes: number;
  rank1Min: number;
  rank2Min: number;
  rank3Min: number;
  frozenThroughRound: number;
  players: Array<{
    registrationId: string;
    playerName: string;
    bibNumber: number | null;
    rank1Position: PlannerPlayer['rank1'];
    rank2Position: PlannerPlayer['rank2'];
    rank3Position: PlannerPlayer['rank3'];
    optInExtraPositions: boolean;
    active: boolean;
  }>;
}): PlannerInput {
  return {
    courts: plan.courts,
    rounds: plan.rounds,
    playMinutes: plan.playMinutes,
    changeoverMinutes: plan.changeoverMinutes,
    windowMinutes: plan.windowMinutes,
    rank1Min: plan.rank1Min,
    rank2Min: plan.rank2Min,
    rank3Min: plan.rank3Min,
    frozenThroughRound: plan.frozenThroughRound,
    inactiveRegistrationIds: plan.players.filter((player) => !player.active).map((player) => player.registrationId),
    players: plan.players.map((player) => ({
      registrationId: player.registrationId,
      name: player.playerName,
      bibNumber: player.bibNumber ?? 0,
      rank1: player.rank1Position,
      rank2: player.rank2Position,
      rank3: player.rank3Position,
      optInExtra: player.optInExtraPositions,
    })),
  };
}

async function nextRevision(tx: Prisma.TransactionClient, eventId: string): Promise<number> {
  const latest = await tx.roundPlan.findFirst({
    where: { eventId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  return (latest?.revision ?? 0) + 1;
}

async function saveDraftRevision(
  tx: Prisma.TransactionClient,
  built: BuiltInput,
  plan: PlannerPlan,
  seed: number,
  options: { sourcePlanId?: string; frozenThroughRound?: number; players?: PlannerPlayer[]; inactiveRegistrationIds?: string[]; warnings?: PlannerGap[] } = {},
): Promise<RoundPlan> {
  if (!(await lockEvent(tx, built.event.id))) throw new Error('event not found');
  const revision = await nextRevision(tx, built.event.id);
  const input = {
    ...built.input,
    players: options.players ?? built.input.players,
    inactiveRegistrationIds: options.inactiveRegistrationIds ?? [],
    frozenThroughRound: options.frozenThroughRound ?? 0,
  };
  const created = await tx.roundPlan.create({
    data: {
      eventId: built.event.id,
      revision,
      sourcePlanId: options.sourcePlanId ?? null,
      frozenThroughRound: input.frozenThroughRound ?? 0,
      validationWarnings: (options.warnings ?? []) as unknown as Prisma.InputJsonValue,
      seed,
      status: 'DRAFT',
      rounds: plan.rounds,
      courts: built.event.courts,
      playMinutes: built.event.playMinutes,
      changeoverMinutes: built.event.changeoverMinutes,
      windowMinutes: built.input.windowMinutes,
      rank1Min: built.event.rank1Min,
      rank2Min: built.event.rank2Min,
      rank3Min: built.event.rank3Min,
      eventName: built.event.name,
      eventDate: built.event.eventDate,
      venue: built.event.venue,
      firstWhistle: built.event.firstWhistle,
    },
  });
  await tx.roundPlanPlayer.createMany({
    data: playerSnapshots(input).map((player) => ({ planId: created.id, ...player })),
  });
  await tx.roundSlot.createMany({ data: planSlots(plan).map((slot) => ({ planId: created.id, ...slot })) });
  return created;
}

function rosterMatches(
  snapshotPlayers: Array<{
    registrationId: string;
    playerName: string;
    bibNumber: number | null;
    rank1Position: PlannerPlayer['rank1'];
    rank2Position: PlannerPlayer['rank2'];
    rank3Position: PlannerPlayer['rank3'];
    optInExtraPositions: boolean;
    active: boolean;
  }>,
  currentPlayers: PlannerPlayer[],
): boolean {
  const activeSnapshots = snapshotPlayers.filter((player) => player.active);
  const snapshotsById = new Map(snapshotPlayers.map((player) => [player.registrationId, player]));
  const current = new Map(currentPlayers.map((player) => [player.registrationId, player]));
  const expectedActivePlayers = currentPlayers.filter((player) => snapshotsById.get(player.registrationId)?.active !== false);
  if (activeSnapshots.length !== expectedActivePlayers.length) return false;
  return activeSnapshots.every((snapshot) => {
    const player = current.get(snapshot.registrationId);
    return Boolean(player && snapshot.playerName === player.name && snapshot.bibNumber === (player.bibNumber || null) &&
      snapshot.rank1Position === player.rank1 && snapshot.rank2Position === player.rank2 &&
      snapshot.rank3Position === player.rank3 && snapshot.optInExtraPositions === player.optInExtra);
  });
}

function stalePlanGap(): PlannerGap {
  return { code: 'no_solution', message: 'The checked-in roster or event settings changed. Generate a new draft for review.' };
}

function failure(message: string): GenerateResult {
  return { ok: false, gaps: [{ code: 'no_solution', message }] };
}

function sameRoster(a: PlannerInput, b: PlannerInput): boolean {
  if (a.players.length !== b.players.length) return false;
  const current = new Map(b.players.map((player) => [player.registrationId, player]));
  return a.players.every((player) => {
    const other = current.get(player.registrationId);
    return Boolean(other && player.name === other.name && player.bibNumber === other.bibNumber &&
      player.rank1 === other.rank1 && player.rank2 === other.rank2 &&
      player.rank3 === other.rank3 && player.optInExtra === other.optInExtra);
  });
}

function sameEvent(a: BuiltInput, b: BuiltInput): boolean {
  return a.event.id === b.event.id && a.event.name === b.event.name &&
    a.event.eventDate.getTime() === b.event.eventDate.getTime() && a.event.venue === b.event.venue &&
    a.event.firstWhistle === b.event.firstWhistle && a.event.lastWhistle === b.event.lastWhistle &&
    a.event.courts === b.event.courts && a.event.playMinutes === b.event.playMinutes &&
    a.event.changeoverMinutes === b.event.changeoverMinutes && a.event.rank1Min === b.event.rank1Min &&
    a.event.rank2Min === b.event.rank2Min && a.event.rank3Min === b.event.rank3Min;
}

export async function generateDraftPlan(
  prisma: PrismaClient,
  eventId: string,
  seed = 1,
): Promise<GenerateResult> {
  const built = await buildInput(prisma, eventId);
  if (!built) throw new Error('event not found');
  const source = built.event.publishedPlanId
    ? await prisma.roundPlan.findUnique({ where: { id: built.event.publishedPlanId }, include: { players: true } })
    : null;
  if (source?.frozenThroughRound) {
    return failure('Played rounds are frozen. Regenerate the remaining rounds from the active published revision.');
  }
  const inactivePlayers = source ? inputFromSnapshot(source).players.filter((player) =>
    source.players.some((snapshot) => snapshot.registrationId === player.registrationId && !snapshot.active)) : [];
  const inactiveRegistrationIds = inactivePlayers.map((player) => player.registrationId);
  const players = [...built.input.players.filter((player) => !inactiveRegistrationIds.includes(player.registrationId)), ...inactivePlayers];
  const input = { ...built.input, players, inactiveRegistrationIds };
  input.rounds = computeMinimumRounds(input);
  const result = await runGeneration({ input, seed });
  if (!result.ok) return { ok: false, gaps: result.gaps };

  const plan = await prisma.$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) return null;
    const current = await buildInput(tx, eventId);
    if (!current || current.event.publishedPlanId !== built.event.publishedPlanId ||
      !sameEvent(built, current) || !sameRoster(built.input, current.input)) return null;
    return saveDraftRevision(tx, built, result.plan, seed, { sourcePlanId: source?.id, players, inactiveRegistrationIds });
  });
  return plan ? { ok: true, plan } : { ok: false, gaps: [stalePlanGap()] };
}

export async function publishPlan(
  prisma: PrismaClient,
  eventId: string,
  planId?: string,
): Promise<GenerateResult> {
  return prisma.$transaction(async (tx): Promise<GenerateResult> => {
    if (!(await lockEvent(tx, eventId))) return failure('Event not found.');
    const built = await buildInput(tx, eventId);
    if (!built) return failure('Event not found.');
    const { publishedPlanId } = built.event;
    const include = { slots: true, players: true } as const;
    const candidate = planId
      ? await tx.roundPlan.findFirst({ where: { id: planId, eventId }, include })
      : await tx.roundPlan.findFirst({ where: { eventId, status: 'DRAFT' }, orderBy: { revision: 'desc' }, include }) ??
        (publishedPlanId ? await tx.roundPlan.findUnique({ where: { id: publishedPlanId }, include }) : null);
    if (!candidate) return failure('No plan is available to publish.');
    // Already published (repeat click or a concurrent publish of the same draft).
    if (candidate.id === publishedPlanId) return { ok: true, plan: candidate };
    if (candidate.status !== 'DRAFT') return failure('Only a draft revision can be published.');
    const newerPublished = await tx.roundPlan.count({ where: { eventId, status: 'PUBLISHED', revision: { gt: candidate.revision } } });
    if (candidate.sourcePlanId !== publishedPlanId || newerPublished > 0) {
      return failure('A newer revision has been published since this draft was created. Review the current plan and regenerate if needed.');
    }
    if (!settingsMatch(candidate, built.event) || !rosterMatches(candidate.players, built.input.players)) {
      return { ok: false, gaps: [stalePlanGap()] };
    }
    const source = publishedPlanId ? await tx.roundPlan.findUnique({ where: { id: publishedPlanId }, include }) : null;
    const candidateSlots = candidate.slots.map((slot) => ({ ...slot, team: slot.team as PlanSlot['team'] }));
    if (source) {
      const sourcePrefix = new Set(source.slots.filter((slot) => slot.round <= candidate.frozenThroughRound).map(slotKey));
      const candidatePrefix = candidateSlots.filter((slot) => slot.round <= candidate.frozenThroughRound);
      if (candidate.frozenThroughRound < source.frozenThroughRound || candidate.frozenThroughRound > source.rounds ||
        candidatePrefix.length !== sourcePrefix.size || candidatePrefix.some((slot) => !sourcePrefix.has(slotKey(slot))) ||
        source.players.some((player) => !player.active && !candidate.players.some((next) => next.registrationId === player.registrationId && !next.active))) {
        return failure('The draft changes frozen rounds or reactivates an inactive player. Regenerate the remaining rounds from the active published revision.');
      }
    }
    const exceptions = source ? frozenExceptions(source, candidateSlots, candidate.frozenThroughRound) : { slots: [], warnings: [] };
    const gaps = verifyPlan({ ...inputFromSnapshot(candidate), approvedFrozenSlots: exceptions.slots }, {
      rounds: candidate.rounds,
      slots: candidateSlots,
    });
    if (gaps.length) return { ok: false, gaps };

    const plan = await tx.roundPlan.update({
      where: { id: candidate.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), validationWarnings: exceptions.warnings as unknown as Prisma.InputJsonValue },
    });
    await tx.event.update({ where: { id: eventId }, data: { publishedPlanId: plan.id } });
    return { ok: true, plan };
  });
}

export async function regenerateFromRound(
  prisma: PrismaClient,
  eventId: string,
  fromRound: number,
  now: Date,
  sourcePlanId?: string,
  removedRegistrationIds: string[] = [],
): Promise<GenerateResult> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new Error('event not found');
  const sourceId = sourcePlanId ?? event.publishedPlanId;
  const source = sourceId
    ? await prisma.roundPlan.findFirst({ where: { id: sourceId, eventId }, include: { slots: true, players: true } })
    : null;
  if (!source || source.status !== 'PUBLISHED' || event.publishedPlanId !== source.id) {
    return failure('The source plan is not the active published revision.');
  }
  if (!Number.isInteger(fromRound) || fromRound < 1 || fromRound > source.rounds) {
    return failure(`fromRound must be between 1 and ${source.rounds}`);
  }
  if (fromRound <= source.frozenThroughRound) {
    const played = source.frozenThroughRound === 1 ? 'Round 1 is' : `Rounds 1-${source.frozenThroughRound} are`;
    return failure(`${played} already played and frozen. Regenerate from round ${source.frozenThroughRound + 1} or later.`);
  }

  const built = await buildInput(prisma, eventId);
  if (!built) throw new Error('event not found');
  if (fromRound > 1 && !settingsMatch(source, built.event)) {
    return { ok: false, gaps: [stalePlanGap()] };
  }
  const uniqueRemovedIds = new Set(removedRegistrationIds);
  if (uniqueRemovedIds.size !== removedRegistrationIds.length) {
    return failure('Early-leaver selections must be unique.');
  }
  const currentPlayers = new Map(built.input.players.map((player) => [player.registrationId, player]));
  const sourcePlayers = new Map(source.players.map((player) => [player.registrationId, player]));
  const removedIds = [...uniqueRemovedIds];
  if (removedIds.some((id) => !currentPlayers.has(id) || !sourcePlayers.get(id)?.active ||
    !source.slots.some((slot) => slot.round >= fromRound && slot.registrationId === id))) {
    return failure('Each early leaver must be an active, paid and checked-in player assigned in the selected suffix.');
  }

  const frozenRows = source.slots.filter((slot) => slot.round < fromRound);
  const currentIds = new Set(currentPlayers.keys());
  const frozenIds = new Set(frozenRows.map((slot) => slot.registrationId));
  const retiredIds = [...frozenIds].filter((registrationId) => !currentIds.has(registrationId));
  const inactiveRegistrationIds = [...new Set([
    ...source.players.filter((player) => !player.active).map((player) => player.registrationId),
    ...removedIds,
    ...retiredIds,
  ])];
  const inactiveSnapshots = inactiveRegistrationIds.map((registrationId) => sourcePlayers.get(registrationId));
  if (inactiveSnapshots.some((player) => !player)) {
    return failure('An inactive or frozen slot has no roster snapshot.');
  }
  for (const player of inactiveSnapshots) {
    currentPlayers.set(player!.registrationId, {
      registrationId: player!.registrationId,
      name: player!.playerName,
      bibNumber: player!.bibNumber ?? 0,
      rank1: player!.rank1Position,
      rank2: player!.rank2Position,
      rank3: player!.rank3Position,
      optInExtra: player!.optInExtraPositions,
    });
  }
  const players = [...currentPlayers.values()];
  const input: PlannerInput = {
    ...built.input,
    rounds: source.rounds,
    players,
    inactiveRegistrationIds,
    frozenThroughRound: fromRound - 1,
  };
  const frozenSlots: PlanSlot[] = frozenRows.map((slot) => ({
    round: slot.round,
    court: slot.court,
    position: slot.position,
    team: slot.team as PlanSlot['team'],
    registrationId: slot.registrationId,
  }));
  const exceptions = frozenExceptions(source, frozenSlots, fromRound - 1);
  input.approvedFrozenSlots = exceptions.slots;
  const seed = Math.floor(now.getTime() / 1000) % 1_000_000;
  const result = await runGeneration({ input, seed, frozenSlots, fromRound, minimumTotalRounds: source.rounds });
  if (!result.ok) return { ok: false, gaps: result.gaps };

  const plan = await prisma.$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) return null;
    const currentEvent = await tx.event.findUnique({ where: { id: eventId } });
    const currentSource = await tx.roundPlan.findFirst({ where: { id: source.id, status: 'PUBLISHED' } });
    const currentBuilt = await buildInput(tx, eventId);
    if (!currentEvent || currentEvent.publishedPlanId !== source.id || !currentSource ||
      !currentBuilt || !sameEvent(built, currentBuilt) || !sameRoster(built.input, currentBuilt.input)) return null;
    return saveDraftRevision(
      tx,
      built,
      result.plan,
      seed,
      { sourcePlanId: source.id, frozenThroughRound: fromRound - 1, players, inactiveRegistrationIds, warnings: exceptions.warnings },
    );
  });
  if (!plan) return { ok: false, gaps: [stalePlanGap()] };
  return { ok: true, plan };
}
