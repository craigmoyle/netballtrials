import { totalTimeMinutes } from './minimum';
import { COURT_POSITIONS } from './types';
import type { PlannerGap, PlannerInput, PlannerPlan, PlannerPlayer } from './types';

function noSolution(message: string, detail?: Record<string, unknown>): PlannerGap {
  return { code: 'no_solution', message, ...(detail ? { detail } : {}) };
}

export function verifyPlan(input: PlannerInput, plan: PlannerPlan): PlannerGap[] {
  const gaps: PlannerGap[] = [];
  const playersById = new Map<string, PlannerPlayer>(input.players.map((player) => [player.registrationId, player]));
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  const activePlayers = input.players.filter((player) => !inactive.has(player.registrationId));

  if (activePlayers.length < input.courts * 14) {
    const needed = input.courts * 14;
    gaps.push({
      code: 'too_few_players',
      message: `${activePlayers.length} checked-in players cannot fill ${input.courts} courts (need ${needed})`,
      detail: { players: activePlayers.length, courts: input.courts, needed },
    });
  }
  if (!Number.isInteger(input.courts) || input.courts < 1 || !Number.isInteger(plan.rounds) || plan.rounds < 1) {
    gaps.push(noSolution('court count and rounds must be positive integers'));
  }

  const expectedSlots = plan.rounds * input.courts * 14;
  if (plan.slots.length !== expectedSlots) {
    gaps.push(noSolution(`expected ${expectedSlots} places but the plan has ${plan.slots.length}`, {
      expected: expectedSlots,
      actual: plan.slots.length,
    }));
  }

  const seenInRound = new Set<string>();
  const seenPlace = new Set<string>();
  const appearances = new Map<string, number>();
  const courtsSeen = new Map<string, Set<number>>();
  const positionCounts = new Map<string, number>();

  for (const slot of plan.slots) {
    if (
      !Number.isInteger(slot.round) || slot.round < 1 || slot.round > plan.rounds ||
      !Number.isInteger(slot.court) || slot.court < 1 || slot.court > input.courts ||
      (slot.team !== 0 && slot.team !== 1) || !COURT_POSITIONS.includes(slot.position)
    ) {
      gaps.push(noSolution('slot contains an invalid round, court, team, or position', {
        registrationId: slot.registrationId,
        round: slot.round,
        court: slot.court,
        team: slot.team,
        position: slot.position,
      }));
      continue;
    }

    const player = playersById.get(slot.registrationId);
    if (!player) {
      gaps.push(noSolution(`slot references unknown registration ${slot.registrationId}`, {
        registrationId: slot.registrationId,
      }));
      continue;
    }
    if (inactive.has(slot.registrationId) && slot.round > (input.frozenThroughRound ?? 0)) {
      gaps.push(noSolution(`${slot.registrationId} is inactive but appears after the frozen prefix`, {
        registrationId: slot.registrationId,
        round: slot.round,
      }));
    }

    const playerRound = `${slot.registrationId}:${slot.round}`;
    if (seenInRound.has(playerRound)) gaps.push(noSolution(`${slot.registrationId} appears twice in round ${slot.round}`));
    seenInRound.add(playerRound);

    const place = `${slot.round}:${slot.court}:${slot.position}:${slot.team}`;
    if (seenPlace.has(place)) gaps.push(noSolution(`place ${place} is filled more than once`));
    seenPlace.add(place);

    appearances.set(slot.registrationId, (appearances.get(slot.registrationId) ?? 0) + 1);
    if (!courtsSeen.has(slot.registrationId)) courtsSeen.set(slot.registrationId, new Set());
    courtsSeen.get(slot.registrationId)!.add(slot.court);
    const positionKey = `${slot.registrationId}:${slot.position}`;
    positionCounts.set(positionKey, (positionCounts.get(positionKey) ?? 0) + 1);

    const selected = [player.rank1, player.rank2, player.rank3].filter(Boolean);
    if (!inactive.has(player.registrationId) && !player.optInExtra && !selected.includes(slot.position)) {
      gaps.push(noSolution(`${player.name} is not opted in but is assigned ${slot.position}`));
    }
  }

  for (let round = 1; round <= plan.rounds; round += 1) {
    for (let court = 1; court <= input.courts; court += 1) {
      for (const position of COURT_POSITIONS) {
        for (const team of [0, 1]) {
          if (!seenPlace.has(`${round}:${court}:${position}:${team}`)) {
            gaps.push(noSolution(`round ${round}, court ${court}, team ${team} is missing ${position}`));
          }
        }
      }
    }
  }

  for (const player of activePlayers) {
    const seen = courtsSeen.get(player.registrationId) ?? new Set<number>();
    for (let court = 1; court <= input.courts; court += 1) {
      if (!seen.has(court)) {
        gaps.push({
          code: 'missing_court_visit',
          message: `${player.name} never plays on court ${court}`,
          detail: { registrationId: player.registrationId, court },
        });
      }
    }
    for (const rank of [
      { position: player.rank1, min: input.rank1Min },
      { position: player.rank2, min: input.rank2Min },
      { position: player.rank3, min: input.rank3Min },
    ]) {
      if (!rank.position || rank.min <= 0) continue;
      const have = positionCounts.get(`${player.registrationId}:${rank.position}`) ?? 0;
      if (have < rank.min) {
        gaps.push({
          code: 'unmet_position_minimum',
          message: `${player.name} has ${have} of ${rank.min} games in ${rank.position}`,
          detail: { registrationId: player.registrationId, position: rank.position, have, need: rank.min },
        });
      }
    }
  }

  const counts = activePlayers.map((player) => appearances.get(player.registrationId) ?? 0);
  if (counts.length > 0 && Math.max(...counts) - Math.min(...counts) > 1) {
    gaps.push(noSolution(`game counts range from ${Math.min(...counts)} to ${Math.max(...counts)}`));
  }

  const timeMinutes = totalTimeMinutes(plan.rounds, input.playMinutes, input.changeoverMinutes);
  if (timeMinutes > input.windowMinutes) {
    gaps.push({
      code: 'time_window',
      message: `${timeMinutes} minutes needed but the window is ${input.windowMinutes}`,
      detail: { needed: timeMinutes, window: input.windowMinutes },
    });
  }
  return gaps;
}
