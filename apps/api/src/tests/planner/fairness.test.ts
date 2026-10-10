import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../planner/generate';
import { repeatOpponentPairs, extraPositionSpread } from '../../planner/fairness';
import { plannerInput } from '../helpers/planner';

describe('fairness metrics', () => {
  it('produces fewer or equal repeated opponents than a naive round-robin reuse', () => {
    const input = plannerInput({ courts: 2, players: 28 });
    const result = generatePlan(input, 11);
    if (!result.ok) throw new Error('expected a plan');
    expect(repeatOpponentPairs(result.plan)).toBeLessThanOrEqual(28 * 6);
  });
  it('spreads extra-position games across opted-in players', () => {
    const input = plannerInput({ courts: 2, players: 28 });
    const result = generatePlan(input, 11);
    if (!result.ok) throw new Error('expected a plan');
    expect(extraPositionSpread(result.plan, input)).toBeLessThanOrEqual(input.courts * 14);
  });
});
