import { totalTimeMinutes } from './minimum';
import type { PlannerGap, PlannerInput, PlannerPlan, PlannerPlayer, Position } from './types';

export function verifyPlan(input: PlannerInput, plan: PlannerPlan): PlannerGap[] {
  const gaps: PlannerGap[] = [];
  const playersById = new Map<string, PlannerPlayer>(
    input.players.map((player) => [player.registrationId, player]),
  );

  if (input.players.length < input.courts * 14) {
    const needed = input.courts * 14;
    gaps.push({
      code: 'too_few_players',
      message: `${input.players.length} checked-in players cannot fill ${input.courts} courts (need ${needed})`,
      detail: { players: input.players.length, courts: input.courts, needed },
    });
  }

  const expectedSlots = plan.rounds * input.courts * 14;
  if (plan.slots.length !== expectedSlots) {
    gaps.push({
      code: 'no_solution',
      message: `expected ${expectedSlots} places but the plan has ${plan.slots.length}`,
      detail: { expected: expectedSlots, actual: plan.slots.length },
    });
  }

  const seenInRound = new Set<string>();
  const seenPlace = new Set<string>();
  const appearances = new Map<string, number>();
  const courtsSeen = new Map<string, Set<number>>();
  const positionCounts = new Map<string, number>();

  for (const slot of plan.slots) {
    const roundKey = `${slot.registrationId}:${slot.round}`;
    if (seenInRound.has(roundKey)) {
      gaps.push({
        code: 'no_solution',
        message: `${slot.registrationId} appears twice in round ${slot.round}`,
      });
    }
    seenInRound.add(roundKey);

    const placeKey = `${slot.round}:${slot.court}:${slot.position}:${slot.team}`;
    if (seenPlace.has(placeKey)) {
      gaps.push({ code: 'no_solution', message: `place ${placeKey} is filled more than once` });
    }
    seenPlace.add(placeKey);

    appearances.set(slot.registrationId, (appearances.get(slot.registrationId) ?? 0) + 1);
    if (!courtsSeen.has(slot.registrationId)) {
      courtsSeen.set(slot.registrationId, new Set());
    }
    courtsSeen.get(slot.registrationId)!.add(slot.court);
    const positionKey = `${slot.registrationId}:${slot.position}`;
    positionCounts.set(positionKey, (positionCounts.get(positionKey) ?? 0) + 1);
  }

  if (!gaps.some((gap) => gap.code === 'no_solution')) {
    for (const player of input.players) {
      const seen = courtsSeen.get(player.registrationId) ?? new Set<number>();
      for (let court = 1; court <= input.courts; court++) {
        if (!seen.has(court)) {
          gaps.push({
            code: 'missing_court_visit',
            message: `${player.name} never plays on court ${court}`,
            detail: { registrationId: player.registrationId, court },
          });
        }
      }
    }

    for (const slot of plan.slots) {
      const player = playersById.get(slot.registrationId);
      if (!player) {
        continue;
      }
      const selected = [player.rank1, player.rank2, player.rank3].filter(
        (value): value is Position => Boolean(value),
      );
      if (!player.optInExtra && !selected.includes(slot.position)) {
        gaps.push({
          code: 'no_solution',
          message: `${player.name} is not opted in but is assigned ${slot.position}`,
        });
      }
    }
  }

  for (const player of input.players) {
    const ranks: { position: Position | null; min: number }[] = [
      { position: player.rank1, min: input.rank1Min },
      { position: player.rank2, min: input.rank2Min },
      { position: player.rank3, min: input.rank3Min },
    ];
    for (const rank of ranks) {
      if (!rank.position || rank.min <= 0) {
        continue;
      }
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

  const counts = input.players.map((player) => appearances.get(player.registrationId) ?? 0);
  if (counts.length > 0) {
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max - min > 1) {
      gaps.push({
        code: 'no_solution',
        message: `game counts range from ${min} to ${max}`,
      });
    }
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
