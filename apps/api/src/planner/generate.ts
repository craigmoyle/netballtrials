import { computeMinimumRounds, totalTimeMinutes } from './minimum';
import { verifyPlan } from './verify';
import { slotKey } from './frozen-exceptions';
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
  allowedMask: number;
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
  push(state.player.rank1);
  push(state.player.rank2);
  push(state.player.rank3);
  if (state.player.optInExtra) {
    for (const position of COURT_POSITIONS) push(position);
  }
  return order;
}

// Hungarian assignment over the 14 position/team seats. Maximizing overdue quotas
// first avoids the greedy dead ends that leave mixed-choice rosters short of games.
function maximumWeightAssignment(weights: number[][], columnCount = weights.length): number[] {
  const n = weights.length;
  const rowPotential = Array(n + 1).fill(0);
  const columnPotential = Array(columnCount + 1).fill(0);
  const columnRow = Array(columnCount + 1).fill(0);
  const previousColumn = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= n; row += 1) {
    columnRow[0] = row;
    let column = 0;
    const distance = Array(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const visited = Array(columnCount + 1).fill(false);
    do {
      visited[column] = true;
      const activeRow = columnRow[column];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= columnCount; candidate += 1) {
        if (visited[candidate]) continue;
        const reduced = -weights[activeRow - 1][candidate - 1] - rowPotential[activeRow] - columnPotential[candidate];
        if (reduced < distance[candidate]) {
          distance[candidate] = reduced;
          previousColumn[candidate] = column;
        }
        if (distance[candidate] < delta) {
          delta = distance[candidate];
          nextColumn = candidate;
        }
      }
      for (let candidate = 0; candidate <= columnCount; candidate += 1) {
        if (visited[candidate]) {
          rowPotential[columnRow[candidate]] += delta;
          columnPotential[candidate] -= delta;
        } else distance[candidate] -= delta;
      }
      column = nextColumn;
    } while (columnRow[column] !== 0);
    do {
      const prior = previousColumn[column];
      columnRow[column] = columnRow[prior];
      column = prior;
    } while (column !== 0);
  }
  const assignment = Array(n).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) {
    if (columnRow[column] !== 0) assignment[columnRow[column] - 1] = column - 1;
  }
  return assignment;
}

function assignCourt(players: PlayerState[], input: PlannerInput): Assigned[] | null {
  const seats = COURT_POSITIONS.flatMap((position) => [
    { position, team: 0 as TeamIndex }, { position, team: 1 as TeamIndex },
  ]);
  const weights = players.map((state) => {
    const owed = new Set(owedPositions(state, input));
    return seats.map(({ position }) => {
      if (!(state.allowedMask & (1 << COURT_POSITIONS.indexOf(position)))) return Number.NEGATIVE_INFINITY;
      const rank = [state.player.rank1, state.player.rank2, state.player.rank3].indexOf(position);
      const allowedCount = state.allowedMask.toString(2).replace(/0/g, '').length;
      const constraintBonus = (7 - allowedCount) * 10_000;
      return (owed.has(position) ? 1_000_000 + constraintBonus : 0) + (rank < 0 ? 0 : (3 - rank) * 100);
    });
  });
  // Forbidden edges use a large finite penalty so the assignment algorithm remains numeric.
  for (const row of weights) for (let column = 0; column < row.length; column += 1) {
    if (row[column] === Number.NEGATIVE_INFINITY) row[column] = -1_000_000_000;
  }
  const assignment = maximumWeightAssignment(weights);
  if (assignment.some((column, row) => weights[row][column] < 0)) return matchCourt(players, input);
  return players.map((state, row) => ({ state, ...seats[assignment[row]] }));
}

// Maximum bipartite matching of players to the court's 14 seats (two per position).
// Players try owed positions first, so quotas still win when a full matching allows it.
function matchSeats(players: PlayerState[], input: PlannerInput): Map<string, PlayerState> {
  const owners = new Map<string, PlayerState>();
  const orders = new Map(players.map((state) => [state, preferenceOrder(state, input)]));
  const place = (state: PlayerState, visited: Set<string>): boolean => {
    for (const position of orders.get(state)!) {
      for (const team of [0, 1]) {
        const seat = `${position}:${team}`;
        if (visited.has(seat)) continue;
        visited.add(seat);
        const owner = owners.get(seat);
        if (!owner || place(owner, visited)) {
          owners.set(seat, state);
          return true;
        }
      }
    }
    return false;
  };
  const byConstraint = [...players].sort((a, b) => orders.get(a)!.length - orders.get(b)!.length);
  for (const state of byConstraint) place(state, new Set());
  return owners;
}

function courtShortfall(players: PlayerState[], input: PlannerInput, cache: Map<string, number>): number {
  // Matching cardinality depends only on allowed positions, not quotas or player identity.
  const key = players.map((state) => state.allowedMask).sort((a, b) => a - b).join(',');
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const shortfall = players.length - matchSeats(players, input).size;
  cache.set(key, shortfall);
  return shortfall;
}

function matchCourt(players: PlayerState[], input: PlannerInput): Assigned[] | null {
  const owners = matchSeats(players, input);
  if (owners.size !== players.length) return null;
  const seats = new Map([...owners].map(([seat, state]) => [state, seat]));
  return players.map((state) => {
    const [position, team] = seats.get(state)!.split(':');
    return { state, position: position as Position, team: team === '0' ? 0 : 1 };
  });
}

// Fixed-position players can bunch on one court while another lacks them. Swap players
// between courts while that lowers the number of seats no one can legally take.
function rebalanceCourts(byCourt: Map<number, PlayerState[]>, input: PlannerInput, cache: Map<string, number>): void {
  const courts = [...byCourt.keys()];
  const shortfall = new Map(courts.map((court) => [court, courtShortfall(byCourt.get(court)!, input, cache)]));
  for (let pass = 0; pass < 14 * courts.length; pass += 1) {
    const court = courts.find((candidate) => shortfall.get(candidate)! > 0);
    if (court === undefined) return;
    let best: { other: number; i: number; j: number; gain: number; seen: number; a: number; b: number } | null = null;
    const players = byCourt.get(court)!;
    for (const other of courts) {
      if (other === court) continue;
      const others = byCourt.get(other)!;
      const before = shortfall.get(court)! + shortfall.get(other)!;
      for (let i = 0; i < players.length; i += 1) {
        for (let j = 0; j < others.length; j += 1) {
          const trial = [...players];
          const otherTrial = [...others];
          [trial[i], otherTrial[j]] = [others[j], players[i]];
          const a = courtShortfall(trial, input, cache);
          const b = courtShortfall(otherTrial, input, cache);
          const gain = before - a - b;
          // Prefer swaps that also send both players to courts they have not seen.
          const seen = Number(others[j].courtsSeen.has(court)) + Number(players[i].courtsSeen.has(other));
          if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && seen < best.seen))) {
            best = { other, i, j, gain, seen, a, b };
          }
        }
      }
    }
    if (!best) return;
    const others = byCourt.get(best.other)!;
    [players[best.i], others[best.j]] = [others[best.j], players[best.i]];
    shortfall.set(court, best.a);
    shortfall.set(best.other, best.b);
  }
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
  // Every court needs two players at each position in every round.
  const perRound = 2 * input.courts;
  for (const position of COURT_POSITIONS) {
    const eligible = activePlayers.filter((player) => player.optInExtra ||
      player.rank1 === position || player.rank2 === position || player.rank3 === position).length;
    if (eligible < perRound) {
      gaps.push({
        code: 'unmet_position_minimum',
        message: `only ${eligible} players can play ${position} but ${input.courts} courts need ${perRound} each round`,
        detail: { position, eligible, needed: perRound },
      });
    }
  }
  return gaps.length > 0 ? gaps : null;
}

function globalAssignmentPlan(input: PlannerInput, seed: number, rounds: number, frozenSlots: PlanSlot[]): PlannerPlan | null {
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  const states: PlayerState[] = input.players.map((player) => ({
    player,
    allowedMask: COURT_POSITIONS.reduce((mask, position, index) =>
      player.optInExtra || [player.rank1, player.rank2, player.rank3].includes(position) ? mask | (1 << index) : mask, 0),
    appearances: 0,
    courtsSeen: new Set<number>(),
    positionGames: new Map<Position, number>(),
  }));
  const statesById = new Map(states.map((state) => [state.player.registrationId, state]));
  const active = states.filter((state) => !inactive.has(state.player.registrationId));
  const slots = [...frozenSlots];
  for (const slot of frozenSlots) {
    const state = statesById.get(slot.registrationId);
    if (!state || slot.round > (input.frozenThroughRound ?? 0)) return null;
    state.appearances += 1;
    state.courtsSeen.add(slot.court);
    state.positionGames.set(slot.position, (state.positionGames.get(slot.position) ?? 0) + 1);
  }
  const random = mulberry32(seed);
  const seats = Array.from({ length: input.courts }, (_, index) => index + 1).flatMap((court) =>
    COURT_POSITIONS.flatMap((position) => [0, 1].map((team) => ({ court, position, team: team as TeamIndex }))),
  );

  for (let round = (input.frozenThroughRound ?? 0) + 1; round <= rounds; round += 1) {
    if (active.length < seats.length) return null;
    const maxAppearances = Math.max(...active.map((state) => state.appearances));
    const weights = seats.map(({ court, position }) => active.map((state) => {
      if (!(state.allowedMask & (1 << COURT_POSITIONS.indexOf(position)))) return -1_000_000_000;
      const rank = [state.player.rank1, state.player.rank2, state.player.rank3].indexOf(position);
      const quota = owedPositions(state, input).includes(position);
      const constraints = 7 - state.allowedMask.toString(2).replace(/0/g, '').length;
      return (quota ? 1_000_000_000 : 0) +
        (quota ? constraints * 10_000 : 0) +
        (state.courtsSeen.has(court) ? 0 : 1_000_000) +
        (maxAppearances - state.appearances) * 10_000 +
        (rank < 0 ? 0 : (3 - rank) * 100) + random();
    }));
    const assignment = maximumWeightAssignment(weights, active.length);
    if (assignment.length !== seats.length || assignment.some((playerIndex, seatIndex) => playerIndex < 0 || weights[seatIndex][playerIndex] < 0)) return null;
    for (let index = 0; index < seats.length; index += 1) {
      const seat = seats[index];
      const state = active[assignment[index]];
      slots.push({ round, court: seat.court, position: seat.position, team: seat.team, registrationId: state.player.registrationId });
      state.appearances += 1;
      state.courtsSeen.add(seat.court);
      state.positionGames.set(seat.position, (state.positionGames.get(seat.position) ?? 0) + 1);
    }
  }
  const plan = { rounds, slots };
  return verifyPlan(input, plan).length === 0 ? plan : null;
}

function nextCourt(state: PlayerState, offset: number, courts: number): number {
  for (let step = 0; step < courts; step += 1) {
    const court = ((offset + step) % courts) + 1;
    if (!state.courtsSeen.has(court)) return court;
  }
  return ((offset + state.appearances) % courts) + 1;
}

function improvePositionQuotas(input: PlannerInput, plan: PlannerPlan): PlannerPlan {
  const states = new Map(input.players.map((player) => [player.registrationId, {
    player, allowedMask: 0, appearances: 0, courtsSeen: new Set<number>(), positionGames: new Map<Position, number>(),
  } satisfies PlayerState]));
  for (const player of input.players) {
    states.get(player.registrationId)!.allowedMask = COURT_POSITIONS.reduce((mask, position, index) =>
      player.optInExtra || [player.rank1, player.rank2, player.rank3].includes(position) ? mask | (1 << index) : mask, 0);
  }
  const groups = new Map<string, PlanSlot[]>();
  for (const slot of plan.slots) {
    states.get(slot.registrationId)?.positionGames.set(slot.position,
      (states.get(slot.registrationId)?.positionGames.get(slot.position) ?? 0) + 1);
    const key = `${slot.round}:${slot.court}`;
    const group = groups.get(key) ?? [];
    group.push(slot);
    groups.set(key, group);
  }

  let improved = true;
  while (improved) {
    improved = false;
    for (const [key, slots] of groups) {
      if (Number(key.split(':')[0]) <= (input.frozenThroughRound ?? 0)) continue;
      const currentStates = slots.map((slot) => states.get(slot.registrationId)!);
      for (const slot of slots) {
        const state = states.get(slot.registrationId)!;
        const count = state.positionGames.get(slot.position) ?? 0;
        if (count <= 1) state.positionGames.delete(slot.position);
        else state.positionGames.set(slot.position, count - 1);
      }
      const score = (assignment: Assigned[]) => assignment.reduce((total, entry) =>
        total + Number(owedPositions(entry.state, input).includes(entry.position)), 0);
      const current = slots.map((slot) => ({ state: states.get(slot.registrationId)!, position: slot.position, team: slot.team }));
      const next = assignCourt(currentStates, input);
      if (next && score(next) > score(current)) {
        const idsBySeat = new Map(next.map((entry) => [`${entry.position}:${entry.team}`, entry.state.player.registrationId]));
        for (const slot of slots) {
          slot.registrationId = idsBySeat.get(`${slot.position}:${slot.team}`)!;
          const state = states.get(slot.registrationId)!;
          state.positionGames.set(slot.position, (state.positionGames.get(slot.position) ?? 0) + 1);
        }
        improved = true;
      } else {
        for (const slot of slots) {
          const state = states.get(slot.registrationId)!;
          state.positionGames.set(slot.position, (state.positionGames.get(slot.position) ?? 0) + 1);
        }
      }
    }
  }
  return plan;
}

function buildPlan(
  input: PlannerInput,
  seed: number,
  rounds: number,
  frozenSlots: PlanSlot[],
  shortfallCache: Map<string, number>,
): PlannerResult & { terminal?: boolean } {
  input = { ...input, players: [...input.players].sort((a, b) => a.registrationId.localeCompare(b.registrationId)) };
  const preflight = preflightGaps(input, rounds);
  if (preflight) return { ok: false, gaps: preflight };
  if (input.players.some((player) => player.rank2 || player.rank3 || player.optInExtra)) {
    const globallyAssigned = globalAssignmentPlan(input, seed, rounds, frozenSlots);
    if (globallyAssigned) return { ok: true, plan: globallyAssigned };
  }

  const rand = mulberry32(seed);
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  const states: PlayerState[] = input.players.map((player) => ({
    player,
    allowedMask: COURT_POSITIONS.reduce((mask, position, index) =>
      player.optInExtra || [player.rank1, player.rank2, player.rank3].includes(position) ? mask | (1 << index) : mask, 0),
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
    rebalanceCourts(byCourt, input, shortfallCache);

    for (let court = 1; court <= input.courts; court += 1) {
      let courtPlayers = byCourt.get(court)!;
      let assigned = assignCourt(courtPlayers, input);
      if (!assigned) {
        let shortfall = courtShortfall(courtPlayers, input, shortfallCache);
        const replaceOrder = courtPlayers
          .map((state, index) => ({ state, index }))
          .sort((a, b) =>
            Number(b.state.courtsSeen.has(court)) - Number(a.state.courtsSeen.has(court)) ||
            Number(b.state.courtsSeen.size === input.courts) - Number(a.state.courtsSeen.size === input.courts) ||
            owedPositions(a.state, input).length - owedPositions(b.state, input).length ||
            b.state.appearances - a.state.appearances || a.index - b.index,
          );
        while (!assigned) {
          const before = shortfall;
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
              const nextShortfall = courtShortfall(trial, input, shortfallCache);
              if (nextShortfall >= shortfall) continue;
              shortfall = nextShortfall;
              unselected.splice(alternateIndex, 1);
              unselected.push(courtPlayers[index]);
              courtPlayers = trial;
              byCourt.set(court, trial);
              assigned = shortfall === 0 ? assignCourt(trial, input) : null;
              break;
            }
          }
          if (shortfall === before) break;
        }
      }

      if (!assigned) {
        return {
          ok: false,
          terminal: true,
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

  const plan = improvePositionQuotas(input, { rounds, slots });
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
    return buildPlan(input, seed, minimumRounds, [], new Map());
  }
  if (minimumRounds > maxRounds) {
    const needed = totalTimeMinutes(minimumRounds, input.playMinutes, input.changeoverMinutes);
    return { ok: false, gaps: [{ code: 'time_window', message: `${needed} minutes needed but the window is ${input.windowMinutes}`, detail: { needed, window: input.windowMinutes } }] };
  }

  return searchPlans(input, seed, minimumRounds, maxRounds, []);
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
  return searchPlans(input, seed, base, max, frozenSlots);
}

// Fixed-position rosters need no seat matching: rotate each position's queue by one
// court per round, with overflow seats resting. Verification still decides feasibility.
function fixedPositionRotation(input: PlannerInput, rounds: number, frozenSlots: PlanSlot[]): PlannerPlan | null {
  if (input.players.some((player) => player.optInExtra || player.rank2 || player.rank3)) return null;
  const inactive = new Set(input.inactiveRegistrationIds ?? []);
  const players = input.players.filter((player) => !inactive.has(player.registrationId))
    .sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const slots: PlanSlot[] = [];
  for (const [positionIndex, position] of COURT_POSITIONS.entries()) {
    const queue = players.filter((player) => player.rank1 === position);
    for (let round = 1; round <= rounds; round++) {
      // A shared zero bit then the three position bits mix opponents without changing courts.
      const teamFlip = (positionIndex >> (3 - ((round - 1) % 4))) & 1;
      queue.forEach((player, index) => {
        const seat = (index + 2 * (round - 1)) % queue.length;
        if (seat < input.courts * 2) slots.push({
          round, court: Math.floor(seat / 2) + 1, position,
          team: ((seat % 2) ^ teamFlip) as TeamIndex, registrationId: player.registrationId,
        });
      });
    }
  }
  const frozenThroughRound = input.frozenThroughRound ?? 0;
  const prefix = slots.filter((slot) => slot.round <= frozenThroughRound);
  const frozenKeys = new Set(frozenSlots.map(slotKey));
  if (prefix.length !== frozenSlots.length || prefix.some((slot) => !frozenKeys.has(slotKey(slot)))) return null;
  const plan = { rounds, slots: [...frozenSlots, ...slots.filter((slot) => slot.round > frozenThroughRound)] };
  return verifyPlan(input, plan).length === 0 ? plan : null;
}

function searchPlans(input: PlannerInput, seed: number, minimum: number, maximum: number, frozenSlots: PlanSlot[]): PlannerResult {
  const impossible = preflightGaps(input, maximum);
  if (impossible) return { ok: false, gaps: impossible };
  const shortfallCache = new Map<string, number>();
  const terminalFailures = new Map<number, PlannerResult>();
  let lastCandidates: PlannerResult[] = [];
  for (let rounds = minimum; rounds <= maximum; rounds += 1) {
    const rotation = fixedPositionRotation(input, rounds, frozenSlots);
    if (rotation) return { ok: true, plan: rotation };
    const candidates = [seed, seed + 1, seed + 2].map((candidateSeed) => {
      const cached = terminalFailures.get(candidateSeed);
      if (cached) return cached;
      const result = buildPlan(input, candidateSeed, rounds, frozenSlots, shortfallCache);
      // A court-fill failure has the same prefix for every total-round count.
      if (result.terminal) terminalFailures.set(candidateSeed, result);
      return result;
    });
    const best = chooseBest(candidates, input);
    if (best) return best;
    lastCandidates = candidates;
    if (terminalFailures.size === 3) break;
  }
  return failureFrom(lastCandidates);
}
