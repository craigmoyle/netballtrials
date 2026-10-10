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
  courtsSeen: Set<number>;
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
    if (position && !order.includes(position)) order.push(position);
  };
  for (const position of owedPositions(state, input)) push(position);
  if (state.player.optInExtra) {
    for (const position of COURT_POSITIONS) push(position);
  } else {
    push(state.player.rank1);
    push(state.player.rank2);
    push(state.player.rank3);
  }
  return order;
}

// Two players per position per court (one for each team). Assign outstanding
// selected-rank quotas before using opted-in extra positions.
function assignCourt(players: PlayerState[], input: PlannerInput): Assigned[] | null {
  const used = new Map<Position, number>(COURT_POSITIONS.map((position) => [position, 0]));
  const assigned = new Map<PlayerState, Position>();
  const owedPairs: { state: PlayerState; position: Position }[] = [];
  for (const state of players) {
    for (const position of owedPositions(state, input)) owedPairs.push({ state, position });
  }
  owedPairs.sort((a, b) => a.state.appearances - b.state.appearances);

  for (const pair of owedPairs) {
    if (assigned.has(pair.state)) continue;
    if ((used.get(pair.position) ?? 0) < 2) {
      used.set(pair.position, (used.get(pair.position) ?? 0) + 1);
      assigned.set(pair.state, pair.position);
    }
  }

  const remaining = players
    .filter((state) => !assigned.has(state))
    .sort((a, b) => a.appearances - b.appearances);
  for (const state of remaining) {
    const position = preferenceOrder(state, input).find((candidate) => (used.get(candidate) ?? 0) < 2);
    if (!position) return null;
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
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  const activePlayers = input.players.filter((player) => !inactive.has(player.registrationId));
  const needed = input.courts * 14;

  if (activePlayers.length < needed) {
    gaps.push({
      code: 'too_few_players',
      message: `${activePlayers.length} checked-in players cannot fill ${input.courts} courts (need ${needed})`,
      detail: { players: activePlayers.length, courts: input.courts, needed },
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

  // Two slots per position per court per round is a necessary quota capacity bound.
  const capacityPerPosition = 2 * input.courts * rounds;
  const demand = new Map<Position, number>();
  const addDemand = (position: Position | null, min: number) => {
    if (position) demand.set(position, (demand.get(position) ?? 0) + min);
  };
  for (const player of activePlayers) {
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

function nextCourt(state: PlayerState, offset: number, courts: number): number {
  for (let step = 0; step < courts; step += 1) {
    const court = ((offset + step) % courts) + 1;
    if (!state.courtsSeen.has(court)) return court;
  }
  return ((offset + state.appearances) % courts) + 1;
}

function buildPlan(
  input: PlannerInput,
  seed: number,
  rounds: number,
  frozenSlots: PlanSlot[],
): PlannerResult {
  input = { ...input, players: [...input.players].sort((a, b) => a.registrationId.localeCompare(b.registrationId)) };
  const preflight = preflightGaps(input, rounds);
  if (preflight) return { ok: false, gaps: preflight };

  const rand = mulberry32(seed);
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  const states: PlayerState[] = input.players.map((player) => ({
    player,
    appearances: 0,
    courtsSeen: new Set<number>(),
    positionGames: new Map<Position, number>(),
  }));
  const statesById = new Map(states.map((state) => [state.player.registrationId, state]));
  const activeStates = states.filter((state) => !inactive.has(state.player.registrationId));
  const offsets = new Map<string, number>(
    activeStates.map((state, index) => [state.player.registrationId, index % input.courts]),
  );
  const slots = [...frozenSlots];

  for (const slot of frozenSlots) {
    const state = statesById.get(slot.registrationId);
    if (!state || slot.round > (input.frozenThroughRound ?? 0)) {
      return { ok: false, gaps: [{ code: 'no_solution', message: 'frozen schedule contains an unknown player or an unfrozen round' }] };
    }
    state.appearances += 1;
    state.courtsSeen.add(slot.court);
    state.positionGames.set(slot.position, (state.positionGames.get(slot.position) ?? 0) + 1);
  }

  const firstUnplayedRound = (input.frozenThroughRound ?? 0) + 1;
  for (let round = firstUnplayedRound; round <= rounds; round += 1) {
    const groups = new Map<number, PlayerState[]>();
    for (let court = 1; court <= input.courts; court += 1) groups.set(court, []);
    for (const state of activeStates) {
      groups.get(nextCourt(state, offsets.get(state.player.registrationId)!, input.courts))!.push(state);
    }

    const tiebreak = new Map<PlayerState, number>();
    for (const state of activeStates) tiebreak.set(state, rand());
    const compare = (a: PlayerState, b: PlayerState) =>
      Number(b.courtsSeen.size < input.courts) - Number(a.courtsSeen.size < input.courts) ||
      a.appearances - b.appearances || tiebreak.get(a)! - tiebreak.get(b)!;
    for (const list of groups.values()) list.sort(compare);

    const byCourt = new Map<number, PlayerState[]>();
    const unselected: PlayerState[] = [];
    for (let court = 1; court <= input.courts; court += 1) {
      const list = groups.get(court)!;
      byCourt.set(court, list.slice(0, 14));
      unselected.push(...list.slice(14));
    }

    for (let court = 1; court <= input.courts; court += 1) {
      const chosen = byCourt.get(court)!;
      while (chosen.length < 14 && unselected.length > 0) {
        unselected.sort((a, b) =>
          Number(a.courtsSeen.has(court)) - Number(b.courtsSeen.has(court)) || compare(a, b),
        );
        chosen.push(unselected.shift()!);
      }
      if (chosen.length < 14) {
        return { ok: false, gaps: [{ code: 'no_solution', message: `could not fill court ${court} in round ${round}` }] };
      }
    }

    for (let court = 1; court <= input.courts; court += 1) {
      let courtPlayers = byCourt.get(court)!;
      let assigned = assignCourt(courtPlayers, input);
      if (!assigned) {
        const replaceOrder = courtPlayers
          .map((state, index) => ({ state, index }))
          .sort((a, b) =>
            Number(b.state.courtsSeen.has(court)) - Number(a.state.courtsSeen.has(court)) ||
            Number(b.state.courtsSeen.size === input.courts) - Number(a.state.courtsSeen.size === input.courts) ||
            owedPositions(a.state, input).length - owedPositions(b.state, input).length ||
            b.state.appearances - a.state.appearances || a.index - b.index,
          );
        for (const { index } of replaceOrder) {
          if (assigned) break;
          const alternatives = [...unselected].sort((a, b) =>
            Number(nextCourt(a, offsets.get(a.player.registrationId)!, input.courts) !== court) -
              Number(nextCourt(b, offsets.get(b.player.registrationId)!, input.courts) !== court) ||
            Number(a.courtsSeen.has(court)) - Number(b.courtsSeen.has(court)) || compare(a, b),
          );
          for (const alternative of alternatives) {
            const alternateIndex = unselected.indexOf(alternative);
            if (alternateIndex < 0) continue;
            const trial = [...courtPlayers];
            trial[index] = alternative;
            const trialAssignment = assignCourt(trial, input);
            if (!trialAssignment) continue;
            unselected.splice(alternateIndex, 1);
            unselected.push(courtPlayers[index]);
            courtPlayers = trial;
            byCourt.set(court, trial);
            assigned = trialAssignment;
            break;
          }
        }
      }

      if (!assigned) {
        return {
          ok: false,
          gaps: [{ code: 'no_solution', message: `could not fill court ${court} in round ${round} with legal positions` }],
        };
      }
      for (const entry of assigned) {
        slots.push({ round, court, position: entry.position, team: entry.team, registrationId: entry.state.player.registrationId });
        entry.state.appearances += 1;
        entry.state.courtsSeen.add(court);
        entry.state.positionGames.set(entry.position, (entry.state.positionGames.get(entry.position) ?? 0) + 1);
      }
    }
  }

  const plan: PlannerPlan = { rounds, slots };
  const gaps = verifyPlan(input, plan);
  return gaps.length === 0
    ? { ok: true, plan }
    : { ok: false, gaps: [...gaps, { code: 'no_solution', message: 'the generator could not satisfy every rule' }] };
}

type PlanScore = [number, number, number];

function scorePlan(plan: PlannerPlan, input: PlannerInput): PlanScore {
  return [repeatOpponentPairs(plan), extraPositionSpread(plan, input), restSpread(plan, input)];
}

function compareScores(a: PlanScore, b: PlanScore): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function chooseBest(candidates: PlannerResult[], input: PlannerInput): PlannerResult | null {
  const successful = candidates.filter(
    (candidate): candidate is { ok: true; plan: PlannerPlan } => candidate.ok,
  );
  if (successful.length === 0) return null;
  let best = successful[0];
  let bestScore = scorePlan(best.plan, input);
  for (const candidate of successful.slice(1)) {
    const score = scorePlan(candidate.plan, input);
    if (compareScores(score, bestScore) < 0) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function maxRoundsWithinWindow(input: PlannerInput): number {
  const duration = input.playMinutes + input.changeoverMinutes;
  return duration > 0 ? Math.floor((input.windowMinutes + input.changeoverMinutes) / duration) : 0;
}

function failureFrom(candidates: PlannerResult[]): PlannerResult {
  const failed = candidates.filter((candidate): candidate is { ok: false; gaps: PlannerGap[] } => !candidate.ok);
  const gaps = failed.flatMap((candidate) => candidate.gaps);
  const unique = [...new Map(gaps.map((gap) => [`${gap.code}:${gap.message}`, gap])).values()];
  return { ok: false, gaps: unique.length ? unique : [{ code: 'no_solution', message: 'no valid schedule was found in the playing window' }] };
}

export function generatePlan(input: PlannerInput, seed: number): PlannerResult {
  const minimumRounds = Math.max(computeMinimumRounds(input), input.rounds);
  const maxRounds = maxRoundsWithinWindow(input);
  if (input.players.filter((player) => !(input.inactiveRegistrationIds ?? []).includes(player.registrationId)).length < input.courts * 14) {
    return buildPlan(input, seed, minimumRounds, []);
  }
  if (minimumRounds > maxRounds) {
    const needed = totalTimeMinutes(minimumRounds, input.playMinutes, input.changeoverMinutes);
    return { ok: false, gaps: [{ code: 'time_window', message: `${needed} minutes needed but the window is ${input.windowMinutes}`, detail: { needed, window: input.windowMinutes } }] };
  }

  let lastCandidates: PlannerResult[] = [];
  for (let rounds = minimumRounds; rounds <= maxRounds; rounds += 1) {
    const candidates = [seed, seed + 1, seed + 2].map((candidateSeed) => buildPlan(input, candidateSeed, rounds, []));
    const best = chooseBest(candidates, input);
    if (best) return best;
    lastCandidates = candidates;
  }
  return failureFrom(lastCandidates);
}

export function generatePlanFromPrefix(
  input: PlannerInput,
  seed: number,
  frozenSlots: PlanSlot[],
  fromRound: number,
  minimumTotalRounds: number,
): PlannerResult {
  if (!Number.isInteger(fromRound) || fromRound < 1 || frozenSlots.some((slot) => slot.round >= fromRound)) {
    return { ok: false, gaps: [{ code: 'no_solution', message: 'regeneration round does not match the frozen prefix' }] };
  }
  const base = Math.max(computeMinimumRounds(input), minimumTotalRounds, fromRound);
  const max = maxRoundsWithinWindow(input);
  if (base > max) {
    const needed = totalTimeMinutes(base, input.playMinutes, input.changeoverMinutes);
    return { ok: false, gaps: [{ code: 'time_window', message: `${needed} minutes needed but the window is ${input.windowMinutes}`, detail: { needed, window: input.windowMinutes } }] };
  }
  input = { ...input, frozenThroughRound: fromRound - 1 };
  let lastCandidates: PlannerResult[] = [];
  for (let rounds = base; rounds <= max; rounds += 1) {
    const candidates = [seed, seed + 1, seed + 2].map((candidateSeed) => buildPlan(input, candidateSeed, rounds, frozenSlots));
    const best = chooseBest(candidates, input);
    if (best) return best;
    lastCandidates = candidates;
  }
  return failureFrom(lastCandidates);
}
