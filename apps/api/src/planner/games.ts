import type { Prisma, PrismaClient, RoundPlan, RoundPlanPlayer, RoundSlot } from '@prisma/client';
import type { GamePlayerDTO, ManualRoundInputDTO, ManualSuffixInputDTO } from '@netball-trials/types';
import { totalTimeMinutes } from './minimum';
import { lockEvent, settingsMatch } from './service';
import { COURT_POSITIONS, type PlannerGap, type PlannerPlayer, type PlanSlot } from './types';

type LoadedPlan = RoundPlan & { slots: RoundSlot[]; players: RoundPlanPlayer[] };
type EligibleRegistration = {
  id: string;
  playerFirstName: string;
  playerLastName: string;
  bibNumber: number | null;
  rank1Position: PlannerPlayer['rank1'];
  rank2Position: PlannerPlayer['rank2'];
  rank3Position: PlannerPlayer['rank3'];
  optInExtraPositions: boolean;
};
type PlanPlayerSnapshot = {
  registrationId: string;
  playerName: string;
  bibNumber: number | null;
  rank1Position: PlannerPlayer['rank1'];
  rank2Position: PlannerPlayer['rank2'];
  rank3Position: PlannerPlayer['rank3'];
  optInExtraPositions: boolean;
  active: boolean;
};

export type ManualRoundResult =
  | { ok: true; plan: LoadedPlan }
  | { ok: false; reason: 'invalid_plan' | 'warnings_required' | 'stale_plan'; errors: PlannerGap[]; warnings: PlannerGap[] };

function gap(message: string, detail?: Record<string, unknown>): PlannerGap {
  return { code: 'no_solution', message, ...(detail ? { detail } : {}) };
}

function positionWarning(message: string, detail?: Record<string, unknown>): PlannerGap {
  return { code: 'position_preference_warning', message, ...(detail ? { detail } : {}) };
}

function placeKey(slot: { round: number; court: number; position: PlanSlot['position']; team: number }): string {
  return `${slot.round}:${slot.court}:${slot.position}:${slot.team}`;
}

function isPosition(value: string): value is PlanSlot['position'] {
  return COURT_POSITIONS.includes(value as PlanSlot['position']);
}

function toPlannerPlayer(registration: EligibleRegistration): PlannerPlayer {
  return {
    registrationId: registration.id,
    name: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    bibNumber: registration.bibNumber ?? 0,
    rank1: registration.rank1Position,
    rank2: registration.rank2Position,
    rank3: registration.rank3Position,
    optInExtra: registration.optInExtraPositions,
  };
}

function toSnapshot(player: PlannerPlayer): PlanPlayerSnapshot {
  return {
    registrationId: player.registrationId,
    playerName: player.name,
    bibNumber: player.bibNumber || null,
    rank1Position: player.rank1,
    rank2Position: player.rank2,
    rank3Position: player.rank3,
    optInExtraPositions: player.optInExtra,
    active: true,
  };
}

function snapshotFromSource(player: RoundPlanPlayer): PlanPlayerSnapshot {
  return {
    registrationId: player.registrationId,
    playerName: player.playerName,
    bibNumber: player.bibNumber,
    rank1Position: player.rank1Position,
    rank2Position: player.rank2Position,
    rank3Position: player.rank3Position,
    optInExtraPositions: player.optInExtraPositions,
    active: false,
  };
}

function mergePlayers(source: LoadedPlan, registrations: EligibleRegistration[], inactiveRegistrationIds: string[] = []): PlanPlayerSnapshot[] {
  const eligible = new Map(registrations.map((registration) => [registration.id, toPlannerPlayer(registration)]));
  const inactive = new Set(inactiveRegistrationIds);
  const sourceIds = new Set(source.players.map((player) => player.registrationId));
  const snapshots = source.players.map((snapshot) => {
    const current = eligible.get(snapshot.registrationId);
    if (snapshot.active && current && !inactive.has(snapshot.registrationId)) return toSnapshot(current);
    return snapshotFromSource(snapshot);
  });
  for (const registration of registrations) {
    if (!sourceIds.has(registration.id)) snapshots.push(toSnapshot(toPlannerPlayer(registration)));
  }
  return snapshots;
}

function slotsForRound(source: LoadedPlan, round: number, input: ManualRoundInputDTO): { slots: PlanSlot[]; errors: PlannerGap[] } {
  const errors: PlannerGap[] = [];
  const byPlace = new Map<string, PlanSlot>(source.slots.map((slot) => [placeKey(slot), {
    round: slot.round,
    court: slot.court,
    position: slot.position,
    team: slot.team === 0 ? 0 : 1,
    registrationId: slot.registrationId,
  }]));
  const submittedPlaces = new Set<string>();

  for (const submitted of input.slots) {
    if (submitted.round !== round) {
      errors.push(gap(`Every submitted slot must belong to round ${round}.`, { round: submitted.round }));
      continue;
    }
    if (!Number.isInteger(submitted.court) || submitted.court < 1 || submitted.court > source.courts ||
      !isPosition(submitted.position) || (submitted.team !== 0 && submitted.team !== 1)) {
      errors.push(gap('A submitted slot has an invalid court, team, or position.', { court: submitted.court, team: submitted.team, position: submitted.position }));
      continue;
    }
    const slot: PlanSlot = { ...submitted, team: submitted.team };
    const key = placeKey(slot);
    if (submittedPlaces.has(key)) {
      errors.push(gap(`Round ${round} contains the same court position more than once.`, { place: key }));
      continue;
    }
    submittedPlaces.add(key);
    byPlace.set(key, slot);
  }

  for (let court = 1; court <= source.courts; court += 1) {
    for (const position of COURT_POSITIONS) {
      for (const team of [0, 1]) {
        const key = `${round}:${court}:${position}:${team}`;
        if (!submittedPlaces.has(key)) errors.push(gap(`Round ${round} is missing court ${court}, ${position}, team ${team}.`));
      }
    }
  }
  return { slots: [...byPlace.values()], errors };
}

function slotsForSuffix(source: LoadedPlan, input: ManualSuffixInputDTO): { slots: PlanSlot[]; errors: PlannerGap[] } {
  const errors: PlannerGap[] = [];
  const prefix: PlanSlot[] = source.slots.filter((slot) => slot.round < input.fromRound).map((slot) => ({
    round: slot.round, court: slot.court, position: slot.position, team: slot.team === 0 ? 0 : 1, registrationId: slot.registrationId,
  }));
  const suffix: PlanSlot[] = [];
  const submittedPlaces = new Set<string>();

  for (const submitted of input.slots) {
    if (submitted.round < input.fromRound || submitted.round > source.rounds ||
      !Number.isInteger(submitted.court) || submitted.court < 1 || submitted.court > source.courts ||
      !isPosition(submitted.position) || (submitted.team !== 0 && submitted.team !== 1)) {
      errors.push(gap('A suffix slot has an invalid round, court, team, or position.', { round: submitted.round, court: submitted.court, team: submitted.team, position: submitted.position }));
      continue;
    }
    const key = placeKey(submitted);
    if (submittedPlaces.has(key)) {
      errors.push(gap(`Suffix court position ${key} is assigned more than once.`));
      continue;
    }
    submittedPlaces.add(key);
    suffix.push({ ...submitted, team: submitted.team });
  }
  return { slots: [...prefix, ...suffix], errors };
}

function validatePlan(
  source: LoadedPlan,
  slots: PlanSlot[],
  registrations: EligibleRegistration[],
): PlannerGap[] {
  const errors: PlannerGap[] = [];
  const currentIds = new Set(registrations.map((registration) => registration.id));
  const sourcePlayers = new Map(source.players.map((player) => [player.registrationId, player]));
  const sourcePlaces = new Map(source.slots.map((slot) => [placeKey(slot), slot.registrationId]));
  const seenPlaces = new Set<string>();
  const seenPlayers = new Set<string>();
  const expectedSlots = source.rounds * source.courts * 14;

  if (slots.length !== expectedSlots) {
    errors.push(gap(`The complete plan must contain ${expectedSlots} court positions.`, { expected: expectedSlots, actual: slots.length }));
  }
  for (const slot of slots) {
    if (!Number.isInteger(slot.round) || slot.round < 1 || slot.round > source.rounds ||
      !Number.isInteger(slot.court) || slot.court < 1 || slot.court > source.courts ||
      !isPosition(slot.position) || (slot.team !== 0 && slot.team !== 1)) {
      errors.push(gap('The complete plan contains an invalid round, court, team, or position.', { round: slot.round, court: slot.court, team: slot.team, position: slot.position }));
      continue;
    }
    const place = placeKey(slot);
    if (seenPlaces.has(place)) errors.push(gap(`Court position ${place} is assigned more than once.`));
    seenPlaces.add(place);
    const playerRound = `${slot.registrationId}:${slot.round}`;
    if (seenPlayers.has(playerRound)) errors.push(gap(`A player appears more than once in round ${slot.round}.`, { registrationId: slot.registrationId, round: slot.round }));
    seenPlayers.add(playerRound);

    const snapshot = sourcePlayers.get(slot.registrationId);
    const currentlyEligible = currentIds.has(slot.registrationId);
    const unchangedCompletedSlot = slot.round <= source.frozenThroughRound && sourcePlaces.get(place) === slot.registrationId;
    if ((!currentlyEligible || (snapshot && !snapshot.active)) && !unchangedCompletedSlot) {
      errors.push(gap('A new or changed assignment must be a paid, checked-in player who is active in this plan.', {
        registrationId: slot.registrationId,
        round: slot.round,
      }));
    }
  }

  for (let round = 1; round <= source.rounds; round += 1) {
    for (let court = 1; court <= source.courts; court += 1) {
      for (const position of COURT_POSITIONS) {
        for (const team of [0, 1]) {
          if (!seenPlaces.has(`${round}:${court}:${position}:${team}`)) {
            errors.push(gap(`Round ${round}, court ${court}, ${position}, team ${team} is unfilled.`));
          }
        }
      }
    }
  }
  return errors;
}

function manualWarnings(
  source: LoadedPlan,
  slots: PlanSlot[],
  snapshots: PlanPlayerSnapshot[],
): PlannerGap[] {
  const activePlayers = snapshots.filter((player) => player.active);
  const byId = new Map(snapshots.map((player) => [player.registrationId, player]));
  const appearances = new Map<string, number>();
  const courts = new Map<string, Set<number>>();
  const positions = new Map<string, number>();
  const warnings: PlannerGap[] = [];

  for (const slot of slots) {
    const player = byId.get(slot.registrationId);
    if (!player) continue;
    appearances.set(slot.registrationId, (appearances.get(slot.registrationId) ?? 0) + 1);
    const visited = courts.get(slot.registrationId) ?? new Set<number>();
    visited.add(slot.court);
    courts.set(slot.registrationId, visited);
    const key = `${slot.registrationId}:${slot.position}`;
    positions.set(key, (positions.get(key) ?? 0) + 1);
    const selected = [player.rank1Position, player.rank2Position, player.rank3Position].filter(Boolean);
    if (!player.optInExtraPositions && !selected.includes(slot.position)) {
      warnings.push(positionWarning(`${player.playerName} is not opted in to ${slot.position}.`, { ...slot }));
    }
  }

  for (const player of activePlayers) {
    for (let court = 1; court <= source.courts; court += 1) {
      if (!courts.get(player.registrationId)?.has(court)) {
        warnings.push({ code: 'missing_court_visit', message: `${player.playerName} does not play on court ${court}.`, detail: { registrationId: player.registrationId, court } });
      }
    }
    for (const [position, minimum] of [
      [player.rank1Position, source.rank1Min],
      [player.rank2Position, source.rank2Min],
      [player.rank3Position, source.rank3Min],
    ] as const) {
      if (!position || minimum <= 0) continue;
      const actual = positions.get(`${player.registrationId}:${position}`) ?? 0;
      if (actual < minimum) {
        warnings.push({ code: 'unmet_position_minimum', message: `${player.playerName} has ${actual} of ${minimum} games in ${position}.`, detail: { registrationId: player.registrationId, position, actual, minimum } });
      }
    }
  }

  const games = activePlayers.map((player) => appearances.get(player.registrationId) ?? 0);
  if (games.length > 0 && Math.max(...games) - Math.min(...games) > 1) {
    warnings.push({ code: 'game_count_fairness_warning', message: `Player game counts range from ${Math.min(...games)} to ${Math.max(...games)}.` });
  }
  const time = totalTimeMinutes(source.rounds, source.playMinutes, source.changeoverMinutes);
  if (time > source.windowMinutes) {
    warnings.push({ code: 'time_window', message: `${time} minutes are scheduled in a ${source.windowMinutes}-minute window.`, detail: { needed: time, window: source.windowMinutes } });
  }
  return warnings;
}

async function createPublishedRevision(
  tx: Prisma.TransactionClient,
  eventId: string,
  source: LoadedPlan,
  slots: PlanSlot[],
  snapshots: PlanPlayerSnapshot[],
  warnings: PlannerGap[],
  now: Date,
  frozenThroughRound = source.frozenThroughRound,
): Promise<LoadedPlan> {
  const latest = await tx.roundPlan.findFirst({ where: { eventId }, orderBy: { revision: 'desc' }, select: { revision: true } });
  const created = await tx.roundPlan.create({
    data: {
      eventId,
      revision: (latest?.revision ?? 0) + 1,
      sourcePlanId: source.id,
      frozenThroughRound,
      seed: source.seed,
      status: 'PUBLISHED',
      rounds: source.rounds,
      courts: source.courts,
      playMinutes: source.playMinutes,
      changeoverMinutes: source.changeoverMinutes,
      windowMinutes: source.windowMinutes,
      rank1Min: source.rank1Min,
      rank2Min: source.rank2Min,
      rank3Min: source.rank3Min,
      eventName: source.eventName,
      eventDate: source.eventDate,
      venue: source.venue,
      gameStartTime: source.gameStartTime,
      publishedAt: now,
      validationWarnings: warnings as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.roundPlanPlayer.createMany({ data: snapshots.map((player) => ({ planId: created.id, ...player })) });
  await tx.roundSlot.createMany({ data: slots.map((slot) => ({ planId: created.id, ...slot })) });
  await tx.event.update({ where: { id: eventId }, data: { publishedPlanId: created.id } });
  return tx.roundPlan.findUniqueOrThrow({ where: { id: created.id }, include: { slots: true, players: true } });
}

export async function saveManualRoundRevision(
  prisma: PrismaClient,
  eventId: string,
  round: number,
  input: ManualRoundInputDTO,
  now: Date,
): Promise<ManualRoundResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) return { ok: false, reason: 'stale_plan', errors: [], warnings: [] };

    const event = await tx.event.findUnique({ where: { id: eventId } });
    const source = await tx.roundPlan.findFirst({
      where: { id: input.sourcePlanId, eventId, status: 'PUBLISHED' },
      include: { slots: true, players: true },
    });
    if (!event || !source || event.publishedPlanId !== source.id || !settingsMatch(source, event)) {
      return { ok: false, reason: 'stale_plan', errors: [], warnings: [] };
    }
    if (!Number.isInteger(round) || round < 1 || round > source.rounds) {
      return { ok: false, reason: 'invalid_plan', errors: [gap(`Round must be between 1 and ${source.rounds}.`)], warnings: [] };
    }

    const registrations = await tx.registration.findMany({
      where: { eventId, status: 'PAID', checkedInAt: { not: null } },
      orderBy: { bibNumber: 'asc' },
      select: {
        id: true,
        playerFirstName: true,
        playerLastName: true,
        bibNumber: true,
        rank1Position: true,
        rank2Position: true,
        rank3Position: true,
        optInExtraPositions: true,
      },
    });
    const roundResult = slotsForRound(source, round, input);
    const errors = [...roundResult.errors, ...validatePlan(source, roundResult.slots, registrations)];
    if (errors.length > 0) return { ok: false, reason: 'invalid_plan', errors, warnings: [] };

    const snapshots = mergePlayers(source, registrations);
    const warnings = manualWarnings(source, roundResult.slots, snapshots);
    if (warnings.length > 0 && !input.overrideWarnings) {
      return { ok: false, reason: 'warnings_required', errors: [], warnings };
    }

    const plan = await createPublishedRevision(tx, eventId, source, roundResult.slots, snapshots, warnings, now);
    return { ok: true, plan };
  });
}

export async function saveManualSuffixRevision(
  prisma: PrismaClient,
  eventId: string,
  input: ManualSuffixInputDTO,
  now: Date,
): Promise<ManualRoundResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await lockEvent(tx, eventId))) return { ok: false, reason: 'stale_plan', errors: [], warnings: [] };

    const event = await tx.event.findUnique({ where: { id: eventId } });
    const source = await tx.roundPlan.findFirst({
      where: { id: input.sourcePlanId, eventId, status: 'PUBLISHED' },
      include: { slots: true, players: true },
    });
    if (!event || !source || event.publishedPlanId !== source.id || !settingsMatch(source, event)) {
      return { ok: false, reason: 'stale_plan', errors: [], warnings: [] };
    }
    if (!Number.isInteger(input.fromRound) || input.fromRound <= source.frozenThroughRound || input.fromRound > source.rounds) {
      return { ok: false, reason: 'invalid_plan', errors: [gap(`Suffix must start after round ${source.frozenThroughRound} and no later than round ${source.rounds}.`)], warnings: [] };
    }
    const removedIds = new Set(input.removedRegistrationIds);
    if (removedIds.size !== input.removedRegistrationIds.length) {
      return { ok: false, reason: 'invalid_plan', errors: [gap('Early-leaver selections must be unique.')], warnings: [] };
    }

    const registrations = await tx.registration.findMany({
      where: { eventId, status: 'PAID', checkedInAt: { not: null } },
      orderBy: { bibNumber: 'asc' },
      select: {
        id: true,
        playerFirstName: true,
        playerLastName: true,
        bibNumber: true,
        rank1Position: true,
        rank2Position: true,
        rank3Position: true,
        optInExtraPositions: true,
      },
    });
    const eligibleIds = new Set(registrations.map((registration) => registration.id));
    const sourcePlayers = new Map(source.players.map((player) => [player.registrationId, player]));
    const errors: PlannerGap[] = [];
    for (const id of removedIds) {
      const hasSuffixAssignment = source.slots.some((slot) => slot.round >= input.fromRound && slot.registrationId === id);
      if (!eligibleIds.has(id) || !sourcePlayers.get(id)?.active || !hasSuffixAssignment) {
        errors.push(gap('Each early leaver must be an active, paid and checked-in player assigned in the selected suffix.', { registrationId: id }));
      }
    }

    const suffix = slotsForSuffix(source, input);
    const validationSource = { ...source, frozenThroughRound: input.fromRound - 1 };
    errors.push(...suffix.errors, ...validatePlan(validationSource, suffix.slots, registrations));
    for (const slot of suffix.slots) {
      if (slot.round >= input.fromRound && removedIds.has(slot.registrationId)) {
        errors.push(gap('An early leaver still has an assignment in the suffix.', { registrationId: slot.registrationId, round: slot.round }));
      }
    }
    if (errors.length > 0) return { ok: false, reason: 'invalid_plan', errors, warnings: [] };

    const inactiveIds = [
      ...source.players.filter((player) => !player.active).map((player) => player.registrationId),
      ...removedIds,
    ];
    const snapshots = mergePlayers(source, registrations, inactiveIds);
    const warnings = manualWarnings(validationSource, suffix.slots, snapshots);
    if (warnings.length > 0 && !input.overrideWarnings) {
      return { ok: false, reason: 'warnings_required', errors: [], warnings };
    }
    const plan = await createPublishedRevision(tx, eventId, source, suffix.slots, snapshots, warnings, now, input.fromRound - 1);
    return { ok: true, plan };
  });
}

export async function getGameRoster(prisma: PrismaClient, eventId: string): Promise<GamePlayerDTO[] | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { publishedPlanId: true } });
  if (!event) return null;
  const currentPlan = event.publishedPlanId
    ? await prisma.roundPlan.findUnique({ where: { id: event.publishedPlanId }, select: { players: { select: { registrationId: true, active: true } } } })
    : null;
  const inactive = new Set(currentPlan?.players.filter((player) => !player.active).map((player) => player.registrationId) ?? []);
  const registrations = await prisma.registration.findMany({
    where: { eventId, status: 'PAID', checkedInAt: { not: null }, bibNumber: { not: null } },
    orderBy: { bibNumber: 'asc' },
    select: {
      id: true,
      playerFirstName: true,
      playerLastName: true,
      bibNumber: true,
      rank1Position: true,
      rank2Position: true,
      rank3Position: true,
      optInExtraPositions: true,
    },
  });
  return registrations.filter((registration) => !inactive.has(registration.id)).map((registration) => ({
    registrationId: registration.id,
    playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    bibNumber: registration.bibNumber!,
    rank1Position: registration.rank1Position,
    rank2Position: registration.rank2Position,
    rank3Position: registration.rank3Position,
    optInExtraPositions: registration.optInExtraPositions,
  }));
}
