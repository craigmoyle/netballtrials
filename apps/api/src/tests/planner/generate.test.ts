import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../planner/generate';
import { verifyPlan } from '../../planner/verify';
import { COURT_POSITIONS } from '../../planner/types';
import { plannerInput } from '../helpers/planner';

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
});
