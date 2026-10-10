import { Prisma, type PrismaClient, type RoundPlan } from '@prisma/client';
import { computeMinimumRounds, totalTimeMinutes } from './minimum';
import { generatePlan, generatePlanFromPrefix } from './generate';
import { verifyPlan } from './verify';
import type { PlannerGap, PlannerInput, PlannerPlayer, PlannerPlan, PlanSlot } from './types';

type Database = PrismaClient | Prisma.TransactionClient;
type BuiltInput = { event: Prisma.EventGetPayload<{}>; input: PlannerInput };
export type GenerateResult = { ok: true; plan: RoundPlan } | { ok: false; gaps: PlannerGap[] };

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
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
  const windowMinutes = Math.max(1, toMinutes(event.lastWhistle) - toMinutes(event.firstWhistle));
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

async function lockEvent(tx: Prisma.TransactionClient, eventId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
  return rows.length === 1;
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
  options: { sourcePlanId?: string; frozenThroughRound?: number; players?: PlannerPlayer[]; inactiveRegistrationIds?: string[] } = {},
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

function settingsMatch(snapshot: {
  eventId: string;
  eventName: string;
  eventDate: Date;
  venue: string;
  firstWhistle: string;
  courts: number;
  playMinutes: number;
  changeoverMinutes: number;
  windowMinutes: number;
  rank1Min: number;
  rank2Min: number;
  rank3Min: number;
}, built: BuiltInput): boolean {
  const event = built.event;
  return snapshot.eventId === event.id && snapshot.eventName === event.name &&
    snapshot.eventDate.toISOString() === event.eventDate.toISOString() && snapshot.venue === event.venue &&
    snapshot.firstWhistle === event.firstWhistle && snapshot.courts === event.courts &&
    snapshot.playMinutes === event.playMinutes && snapshot.changeoverMinutes === event.changeoverMinutes &&
    snapshot.windowMinutes === built.input.windowMinutes && snapshot.rank1Min === event.rank1Min &&
    snapshot.rank2Min === event.rank2Min && snapshot.rank3Min === event.rank3Min;
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
  if (activeSnapshots.length !== currentPlayers.length) return false;
  const current = new Map(currentPlayers.map((player) => [player.registrationId, player]));
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
  _now: Date,
  seed = 1,
): Promise<GenerateResult> {
  const built = await buildInput(prisma, eventId);
  if (!built) throw new Error('event not found');
  const result = generatePlan(built.input, seed);
  if (!result.ok) return { ok: false, gaps: result.gaps };

  const plan = await prisma.$transaction((tx) => saveDraftRevision(tx, built, result.plan, seed));
  return { ok: true, plan };
}

export async function publishPlan(
  prisma: PrismaClient,
  eventId: string,
  planId?: string,
): Promise<GenerateResult> {
  const eventState = await prisma.event.findUnique({ where: { id: eventId }, select: { publishedPlanId: true } });
  if (!eventState) return { ok: false, gaps: [{ code: 'no_solution', message: 'Event not found.' }] };
  const candidate = planId
    ? await prisma.roundPlan.findFirst({ where: { id: planId, eventId }, include: { slots: true, players: true } })
    : await prisma.roundPlan.findFirst({
        where: { eventId, status: 'DRAFT' },
        orderBy: { revision: 'desc' },
        include: { slots: true, players: true },
      }) ?? (eventState.publishedPlanId
        ? await prisma.roundPlan.findUnique({ where: { id: eventState.publishedPlanId }, include: { slots: true, players: true } })
        : null);
  if (!candidate) return { ok: false, gaps: [{ code: 'no_solution', message: 'No plan is available to publish.' }] };
  if (candidate.id === eventState.publishedPlanId && candidate.status === 'PUBLISHED') {
    return { ok: true, plan: candidate };
  }
  if (candidate.status !== 'DRAFT') {
    return { ok: false, gaps: [{ code: 'no_solution', message: 'Only a draft revision can be published.' }] };
  }

  const built = await buildInput(prisma, eventId);
  if (!built) throw new Error('event not found');
  if (!settingsMatch(candidate, built) || !rosterMatches(candidate.players, built.input.players)) {
    return { ok: false, gaps: [stalePlanGap()] };
  }

  const input = inputFromSnapshot(candidate);
  const plan: PlannerPlan = {
    rounds: candidate.rounds,
    slots: candidate.slots.map((slot) => ({
      round: slot.round,
      court: slot.court,
      position: slot.position,
      team: slot.team === 0 ? 0 : 1,
      registrationId: slot.registrationId,
    })),
  };
  const gaps = verifyPlan(input, plan);
  if (gaps.length) return { ok: false, gaps };

  const published = await prisma.$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) return null;
    const current = await tx.roundPlan.findFirst({
      where: { id: candidate.id, eventId, status: 'DRAFT' },
      include: { slots: true, players: true },
    });
    if (!current) return null;
    const currentBuilt = await buildInput(tx, eventId);
    if (!currentBuilt || !settingsMatch(current, currentBuilt) || !rosterMatches(current.players, currentBuilt.input.players)) return null;
    const currentGaps = verifyPlan(inputFromSnapshot(current), {
      rounds: current.rounds,
      slots: current.slots.map((slot) => ({ ...slot, team: slot.team === 0 ? 0 : 1 })),
    });
    if (currentGaps.length) return null;

    const updated = await tx.roundPlan.update({
      where: { id: current.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await tx.event.update({ where: { id: eventId }, data: { publishedPlanId: updated.id } });
    return updated;
  });
  if (!published) return { ok: false, gaps: [stalePlanGap()] };
  return { ok: true, plan: published };
}

export async function regenerateFromRound(
  prisma: PrismaClient,
  eventId: string,
  fromRound: number,
  now: Date,
  sourcePlanId?: string,
): Promise<GenerateResult> {
  const source = await prisma.roundPlan.findFirst({
    where: { eventId, ...(sourcePlanId ? { id: sourcePlanId } : { status: 'PUBLISHED' }) },
    orderBy: { revision: 'desc' },
    include: { slots: true, players: true },
  });
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new Error('event not found');
  if (!source || source.status !== 'PUBLISHED' || event.publishedPlanId !== source.id) {
    return { ok: false, gaps: [{ code: 'no_solution', message: 'The source plan is not the active published revision.' }] };
  }
  if (!Number.isInteger(fromRound) || fromRound < 1 || fromRound > source.rounds) {
    return { ok: false, gaps: [{ code: 'no_solution', message: `fromRound must be between 1 and ${source.rounds}` }] };
  }

  const built = await buildInput(prisma, eventId);
  if (!built) throw new Error('event not found');
  if (fromRound > 1 && !settingsMatch(source, built)) {
    return { ok: false, gaps: [stalePlanGap()] };
  }
  const frozenRows = source.slots.filter((slot) => slot.round < fromRound);
  const currentIds = new Set(built.input.players.map((player) => player.registrationId));
  const frozenIds = new Set(frozenRows.map((slot) => slot.registrationId));
  const sourcePlayers = new Map(source.players.map((player) => [player.registrationId, player]));
  const retiredSnapshots = [...frozenIds]
    .filter((registrationId) => !currentIds.has(registrationId))
    .map((registrationId) => sourcePlayers.get(registrationId));
  if (retiredSnapshots.some((player) => !player)) {
    return { ok: false, gaps: [{ code: 'no_solution', message: 'A frozen slot has no roster snapshot.' }] };
  }

  const retiredPlayers: PlannerPlayer[] = retiredSnapshots.map((player) => ({
    registrationId: player!.registrationId,
    name: player!.playerName,
    bibNumber: player!.bibNumber ?? 0,
    rank1: player!.rank1Position,
    rank2: player!.rank2Position,
    rank3: player!.rank3Position,
    optInExtra: player!.optInExtraPositions,
  }));
  const inactiveRegistrationIds = retiredPlayers.map((player) => player.registrationId);
  const players = [...built.input.players, ...retiredPlayers];
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
    team: slot.team === 0 ? 0 : 1,
    registrationId: slot.registrationId,
  }));
  const seed = Math.floor(now.getTime() / 1000) % 1_000_000;
  const result = generatePlanFromPrefix(input, seed, frozenSlots, fromRound, source.rounds);
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
      { sourcePlanId: source.id, frozenThroughRound: fromRound - 1, players, inactiveRegistrationIds },
    );
  });
  if (!plan) return { ok: false, gaps: [stalePlanGap()] };
  return { ok: true, plan };
}
