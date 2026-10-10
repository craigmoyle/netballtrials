import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../planner/generate';
import { verifyPlan } from '../../planner/verify';
import { plannerInput } from '../helpers/planner';

// Ruling: the plan's `{ courts: 2, players: 21 }` case is infeasible (21 players
// cannot fill two courts of 14, and the gap test calls 20 players too few), so it
// is replaced by a feasible 29-player case; the infeasible boundary is covered in
// the too_few_players test below.
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
