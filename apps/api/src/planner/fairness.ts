import type { PlannerInput, PlannerPlan, Position } from './types';

export function repeatOpponentPairs(plan: PlannerPlan): number {
  const seen = new Set<string>();
  const cells = new Map<string, { team0: string[]; team1: string[] }>();

  for (const slot of plan.slots) {
    const key = `${slot.round}:${slot.court}`;
    if (!cells.has(key)) {
      cells.set(key, { team0: [], team1: [] });
    }
    const cell = cells.get(key)!;
    (slot.team === 0 ? cell.team0 : cell.team1).push(slot.registrationId);
  }

  const keys = [...cells.keys()].sort((a, b) => {
    const [roundA, courtA] = a.split(':').map(Number);
    const [roundB, courtB] = b.split(':').map(Number);
    return roundA - roundB || courtA - courtB;
  });

  let repeats = 0;
  for (const key of keys) {
    const { team0, team1 } = cells.get(key)!;
    for (const a of team0) {
      for (const b of team1) {
        const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(pair)) {
          repeats += 1;
        }
        seen.add(pair);
      }
    }
  }
  return repeats;
}

export function extraPositionSpread(plan: PlannerPlan, input: PlannerInput): number {
  const playersById = new Map(input.players.map((player) => [player.registrationId, player]));
  const counts = new Map<string, number>();

  for (const slot of plan.slots) {
    const player = playersById.get(slot.registrationId);
    if (!player || !player.optInExtra) {
      continue;
    }
    const selected = [player.rank1, player.rank2, player.rank3].filter(
      (position): position is Position => Boolean(position),
    );
    if (!selected.includes(slot.position)) {
      counts.set(slot.registrationId, (counts.get(slot.registrationId) ?? 0) + 1);
    }
  }

  return counts.size > 0 ? Math.max(...counts.values()) : 0;
}

export function restSpread(plan: PlannerPlan, input: PlannerInput): number {
  const appearances = new Map<string, number>();
  for (const slot of plan.slots) {
    appearances.set(slot.registrationId, (appearances.get(slot.registrationId) ?? 0) + 1);
  }
  const rests = input.players.map(
    (player) => plan.rounds - (appearances.get(player.registrationId) ?? 0),
  );
  if (rests.length === 0) {
    return 0;
  }
  return Math.max(...rests) - Math.min(...rests);
}
