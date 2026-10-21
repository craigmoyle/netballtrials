import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../planner/generate';
import { verifyPlan } from '../../planner/verify';
import { COURT_POSITIONS } from '../../planner/types';
import { player, plannerInput } from '../helpers/planner';

// Ruling: the plan's `{ courts: 2, players: 21 }` case is infeasible (21 players
// cannot fill two courts of 14, and the gap test calls 20 players too few), so it
// is replaced by a feasible 29-player case; the infeasible boundary is covered below.
const cases = [
  { courts: 1, players: 14 },
  { courts: 2, players: 28 },
  { courts: 5, players: 71 },
  { courts: 2, players: 29 },
];

describe('generatePlan', () => {
  it.each(cases)('fills every court and passes verification for %o', ({ courts, players }) => {
    const input = plannerInput({ courts, players });
    const result = generatePlan(input, 7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyPlan(input, result.plan)).toEqual([]);
  });

  it('increases rounds when a position minimum is feasible only with more games', () => {
    const input = plannerInput({
      courts: 1,
      players: Array.from({ length: 14 }, (_, index) => ({
        registrationId: `gs-${index}`,
        name: `GS player ${index}`,
        bibNumber: index + 1,
        rank1: 'GS' as const,
        rank2: null,
        rank3: null,
        optInExtra: true,
      })),
      rounds: 1,
      playMinutes: 8,
      changeoverMinutes: 2,
      windowMinutes: 68,
      rank1Min: 1,
      rank2Min: 0,
      rank3Min: 0,
    });
    const result = generatePlan(input, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.rounds).toBe(7);
      expect(verifyPlan(input, result.plan)).toEqual([]);
    }
  });

  it('does not change a feasible assignment when roster order changes', () => {
    const input = plannerInput({
      courts: 2,
      players: Array.from({ length: 28 }, (_, index) => ({
        registrationId: `roster-${String(index).padStart(2, '0')}`,
        name: `Player ${index}`,
        bibNumber: index + 1,
        rank1: COURT_POSITIONS[index % COURT_POSITIONS.length],
        rank2: null,
        rank3: null,
        optInExtra: false,
      })),
      rank1Min: 1,
      rank2Min: 0,
      rank3Min: 0,
    });
    const shuffled = { ...input, players: [...input.players].reverse() };
    const first = generatePlan(input, 9);
    const second = generatePlan(shuffled, 9);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      const canonical = (plan: typeof first.plan) => plan.slots
        .map((slot) => `${slot.round}:${slot.court}:${slot.team}:${slot.position}:${slot.registrationId}`)
        .sort();
      expect(canonical(second.plan)).toEqual(canonical(first.plan));
    }
  });

  it('finds a feasible distribution with six fixed-GS players and rotating rests', () => {
    const rankPositions = ['GS', 'GS', 'GS', 'GS', 'GS', 'GS', 'GA', 'GA', 'GA', 'GA', 'WA', 'WA', 'WA', 'WA', 'C', 'C', 'C', 'C', 'WD', 'WD', 'WD', 'WD', 'GD', 'GD', 'GD', 'GD', 'GK', 'GK', 'GK', 'GK'] as const;
    const input = plannerInput({
      courts: 2,
      rounds: 3,
      windowMinutes: 28,
      rank1Min: 1,
      rank2Min: 0,
      rank3Min: 0,
      players: rankPositions.map((rank1, index) => ({
        registrationId: `position-${String(index).padStart(2, '0')}`,
        name: `Player ${index}`,
        bibNumber: index + 1,
        rank1,
        rank2: null,
        rank3: null,
        optInExtra: false,
      })),
    });
    for (const seed of [1, 4, 19]) {
      const result = generatePlan(input, seed);
      expect(result.ok).toBe(true);
      if (result.ok) expect(verifyPlan(input, result.plan)).toEqual([]);
    }
  });

  it('is deterministic for the same seed', () => {
    const input = plannerInput({ courts: 2, players: 28 });
    const a = generatePlan(input, 1);
    const b = generatePlan(input, 1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps game counts within one of each other', () => {
    const input = plannerInput({ courts: 2, players: 30 });
    const result = generatePlan(input, 3);
    if (!result.ok) throw new Error('expected a plan');
    const counts = new Map<string, number>();
    for (const slot of result.plan.slots) {
      counts.set(slot.registrationId, (counts.get(slot.registrationId) ?? 0) + 1);
    }
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it('refuses to fill more courts than there are players', () => {
    const result = generatePlan(plannerInput({ courts: 2, players: 21 }), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gaps.map((gap) => gap.code)).toContain('too_few_players');
  });

  const fixedRoster = (skip: number) => Array.from({ length: 30 }, (_, index) => index)
    .filter((index) => index !== skip)
    .map((index) => player(`f${index}`, COURT_POSITIONS[index % COURT_POSITIONS.length], null, null, { optInExtra: false, bib: index + 1 }));

  it('balances fixed-position players across courts when a position has exactly enough players', () => {
    // Removing one of five GS players leaves exactly four GS for two courts every round.
    const input = plannerInput({ courts: 2, players: fixedRoster(7) });
    for (let seed = 1; seed <= 10; seed += 1) {
      const result = generatePlan(input, seed);
      expect(result.ok, `seed ${seed}`).toBe(true);
      if (result.ok) expect(verifyPlan(input, result.plan)).toEqual([]);
    }
  });

  it('explains which position has too few players instead of a generic failure', () => {
    // Removing one of four WA players leaves three WA-only players for four WA places.
    const result = generatePlan(plannerInput({ courts: 2, players: fixedRoster(2) }), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.gaps).toContainEqual(expect.objectContaining({
        code: 'unmet_position_minimum',
        message: 'only 3 players can play WA but 2 courts need 4 each round',
      }));
    }
  });
});

describe('assignCourt with mixed opt-in rosters', () => {
  const ranks = ['GA', 'GA', 'WA', 'WA', 'C', 'C', 'WD', 'WD', 'GD', 'GD', 'GK', 'GK'] as const;
  const mixed = plannerInput({
    courts: 1,
    rank1Min: 0,
    rank2Min: 0,
    rank3Min: 0,
    players: [
      ...ranks.map((rank1, index) => ({
        registrationId: `a-opted-${String(index).padStart(2, '0')}`,
        name: `Opted ${index}`,
        bibNumber: index + 1,
        rank1,
        rank2: COURT_POSITIONS[(index + 3) % COURT_POSITIONS.length],
        rank3: null,
        optInExtra: true,
      })),
      ...[0, 1].map((index) => ({
        registrationId: `z-gs-only-${index}`,
        name: `GS only ${index}`,
        bibNumber: 20 + index,
        rank1: 'GS' as const,
        rank2: null,
        rank3: null,
        optInExtra: false,
      })),
    ],
  });

  it('fills the court for every seed when non-opted-in players need the same position', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const result = generatePlan(mixed, seed);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) expect(verifyPlan(mixed, result.plan)).toEqual([]);
    }
  });

  it('places opted-in players on their ranked positions when those seats are free', () => {
    const result = generatePlan(mixed, 3);
    if (!result.ok) throw new Error('expected a plan');
    const byId = new Map(mixed.players.map((player) => [player.registrationId, player]));
    for (const slot of result.plan.slots) {
      expect(slot.position).toBe(byId.get(slot.registrationId)!.rank1);
    }
  });
});
