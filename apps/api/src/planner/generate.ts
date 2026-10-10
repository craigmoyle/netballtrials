import { computeMinimumRounds, totalTimeMinutes } from './minimum';
import { verifyPlan } from './verify';
import { extraPositionSpread, repeatOpponentPairs, restSpread } from './fairness';
import { COURT_POSITIONS } from './types';
import type {
  PlannerGap,
  PlannerInput,
  PlannerPlan,
  PlannerPlayer,
  PlannerResult,
  PlanSlot,
  Position,
  TeamIndex,
} from './types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlayerState {
  player: PlannerPlayer;
  appearances: number;
  positionGames: Map<Position, number>;
}

interface Assigned {
  state: PlayerState;
  position: Position;
  team: TeamIndex;
}

function owedPositions(state: PlayerState, input: PlannerInput): Position[] {
  const owed: Position[] = [];
  const check = (position: Position | null, min: number) => {
    if (position && (state.positionGames.get(position) ?? 0) < min) {
      owed.push(position);
    }
  };
  check(state.player.rank1, input.rank1Min);
  check(state.player.rank2, input.rank2Min);
  check(state.player.rank3, input.rank3Min);
  return owed;
}

function preferenceOrder(state: PlayerState, input: PlannerInput): Position[] {
  const order: Position[] = [];
  const push = (position: Position | null) => {
    if (position && !order.includes(position)) {
      order.push(position);
    }
  };
  for (const position of owedPositions(state, input)) {
    push(position);
  }
  if (state.player.optInExtra) {
    for (const position of COURT_POSITIONS) {
      push(position);
    }
  } else {
    push(state.player.rank1);
    push(state.player.rank2);
    push(state.player.rank3);
  }
  return order;
}

// Two players per position per court (one for each team). Players who still owe
// a rank minimum are seated first so quotas are met before preferences.
function assignCourt(players: PlayerState[], input: PlannerInput): Assigned[] | null {
  const used = new Map<Position, number>(COURT_POSITIONS.map((position) => [position, 0]));
  const assigned = new Map<PlayerState, Position>();

  const owedPairs: { state: PlayerState; position: Position }[] = [];
  for (const state of players) {
    for (const position of owedPositions(state, input)) {
      owedPairs.push({ state, position });
    }
  }
  owedPairs.sort((a, b) => a.state.appearances - b.state.appearances);

  for (const pair of owedPairs) {
    if (assigned.has(pair.state)) {
      continue;
    }
    if ((used.get(pair.position) ?? 0) < 2) {
      used.set(pair.position, (used.get(pair.position) ?? 0) + 1);
      assigned.set(pair.state, pair.position);
    }
  }

  const rest = players
    .filter((state) => !assigned.has(state))
    .sort((a, b) => a.appearances - b.appearances);
  for (const state of rest) {
    const position = preferenceOrder(state, input).find((candidate) => (used.get(candidate) ?? 0) < 2);
    if (!position) {
      return null;
    }
    used.set(position, (used.get(position) ?? 0) + 1);
    assigned.set(state, position);
  }

  const teamCount = new Map<Position, number>(COURT_POSITIONS.map((position) => [position, 0]));
  return players.map((state) => {
    const position = assigned.get(state)!;
    const index = teamCount.get(position) ?? 0;
    teamCount.set(position, index + 1);
    return { state, position, team: index === 0 ? 0 : 1 };
  });
}

function preflightGaps(input: PlannerInput, rounds: number): PlannerGap[] | null {
  const gaps: PlannerGap[] = [];
  const needed = input.courts * 14;

  if (input.players.length < needed) {
    gaps.push({
      code: 'too_few_players',
      message: `${input.players.length} checked-in players cannot fill ${input.courts} courts (need ${needed})`,
      detail: { players: input.players.length, courts: input.courts, needed },
    });
  }

  const timeMinutes = totalTimeMinutes(rounds, input.playMinutes, input.changeoverMinutes);
  if (timeMinutes > input.windowMinutes) {
    gaps.push({
      code: 'time_window',
      message: `${timeMinutes} minutes needed but the window is ${input.windowMinutes}`,
      detail: { needed: timeMinutes, window: input.windowMinutes },
    });
  }

  // A position hosts at most two players per court per round, so the whole event
  // can satisfy at most 2 * courts * rounds games at any one position.
  const capacityPerPosition = 2 * input.courts * rounds;
  const demand = new Map<Position, number>();
  const addDemand = (position: Position | null, min: number) => {
    if (position) {
      demand.set(position, (demand.get(position) ?? 0) + min);
    }
  };
  for (const player of input.players) {
    addDemand(player.rank1, input.rank1Min);
    addDemand(player.rank2, input.rank2Min);
    addDemand(player.rank3, input.rank3Min);
  }
  for (const position of COURT_POSITIONS) {
    const required = demand.get(position) ?? 0;
    if (required > capacityPerPosition) {
      gaps.push({
        code: 'unmet_position_minimum',
        message: `only ${capacityPerPosition} places at ${position} but ${required} are required`,
        detail: { position, required, capacity: capacityPerPosition },
      });
    }
  }

  return gaps.length > 0 ? gaps : null;
}

function buildPlan(input: PlannerInput, seed: number): PlannerResult {
  const rounds = computeMinimumRounds(input);

  const preflight = preflightGaps(input, rounds);
  if (preflight) {
    return { ok: false, gaps: preflight };
  }

  const rand = mulberry32(seed);
  const states: PlayerState[] = input.players.map((player) => ({
    player,
    appearances: 0,
    positionGames: new Map<Position, number>(),
  }));
  const offset = new Map<string, number>(
    input.players.map((player, index) => [player.registrationId, index % input.courts]),
  );

  const slots: PlanSlot[] = [];

  for (let round = 1; round <= rounds; round++) {
    // Rotate each player through the courts by play count, not by round, so a
    // player who plays at least `courts` times always visits every court. A
    // player whose next court is full sits out rather than being displaced.
    const groups = new Map<number, PlayerState[]>();
    for (let court = 1; court <= input.courts; court++) {
      groups.set(court, []);
    }
    for (const state of states) {
      const nextCourt =
        ((offset.get(state.player.registrationId)! + state.appearances) % input.courts) + 1;
      groups.get(nextCourt)!.push(state);
    }

    const tiebreak = new Map<PlayerState, number>();
    for (const state of states) {
      tiebreak.set(state, rand());
    }
    const compare = (a: PlayerState, b: PlayerState) =>
      a.appearances - b.appearances || tiebreak.get(a)! - tiebreak.get(b)!;
    for (const list of groups.values()) {
      list.sort(compare);
    }

    const byCourt = new Map<number, PlayerState[]>();
    const unselected: PlayerState[] = [];
    for (let court = 1; court <= input.courts; court++) {
      const list = groups.get(court)!;
      byCourt.set(court, list.slice(0, 14));
      for (const state of list.slice(14)) {
        unselected.push(state);
      }
    }

    for (let court = 1; court <= input.courts; court++) {
      const chosen = byCourt.get(court)!;
      while (chosen.length < 14 && unselected.length > 0) {
        unselected.sort(compare);
        chosen.push(unselected.shift()!);
      }
      if (chosen.length < 14) {
        return {
          ok: false,
          gaps: [
            {
              code: 'no_solution',
              message: `could not fill court ${court} in round ${round}`,
            },
          ],
        };
      }
    }

    for (let court = 1; court <= input.courts; court++) {
      const assigned = assignCourt(byCourt.get(court)!, input);
      if (!assigned) {
        return {
          ok: false,
          gaps: [
            {
              code: 'no_solution',
              message: `could not fill court ${court} in round ${round}`,
            },
          ],
        };
      }
      for (const entry of assigned) {
        slots.push({
          round,
          court,
          position: entry.position,
          team: entry.team,
          registrationId: entry.state.player.registrationId,
        });
        entry.state.appearances += 1;
        entry.state.positionGames.set(
          entry.position,
          (entry.state.positionGames.get(entry.position) ?? 0) + 1,
        );
      }
    }
  }

  const plan: PlannerPlan = { rounds, slots };
  const gaps = verifyPlan(input, plan);
  if (gaps.length === 0) {
    return { ok: true, plan };
  }
  return {
    ok: false,
    gaps: [...gaps, { code: 'no_solution', message: 'the generator could not satisfy every rule' }],
  };
}

type PlanScore = [number, number, number];

function scorePlan(plan: PlannerPlan, input: PlannerInput): PlanScore {
  return [repeatOpponentPairs(plan), extraPositionSpread(plan, input), restSpread(plan, input)];
}

function compareScores(a: PlanScore, b: PlanScore): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function generatePlan(input: PlannerInput, seed: number): PlannerResult {
  const candidates = [seed, seed + 1, seed + 2].map((candidateSeed) =>
    buildPlan(input, candidateSeed),
  );
  const successful = candidates.filter(
    (candidate): candidate is { ok: true; plan: PlannerPlan } => candidate.ok,
  );
  if (successful.length === 0) {
    return candidates[0];
  }

  let best = successful[0];
  let bestScore = scorePlan(best.plan, input);
  for (let index = 1; index < successful.length; index += 1) {
    const candidateScore = scorePlan(successful[index].plan, input);
    if (compareScores(candidateScore, bestScore) < 0) {
      best = successful[index];
      bestScore = candidateScore;
    }
  }
  return best;
}
