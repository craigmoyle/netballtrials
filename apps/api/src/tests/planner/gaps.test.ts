import { describe, it, expect } from 'vitest';
import { generatePlan } from '../../planner/generate';
import { plannerInput } from '../helpers/planner';

describe('gap reporting', () => {
  it('reports too few players with the numbers', () => {
    const result = generatePlan(plannerInput({ courts: 2, players: 20 }), 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const gap = result.gaps.find((entry) => entry.code === 'too_few_players')!;
    expect(gap.message).toContain('20');
    expect(gap.message).toContain('28');
  });
  it('reports a time window that is too short', () => {
    const result = generatePlan(
      plannerInput({ courts: 5, players: 71, playMinutes: 8, changeoverMinutes: 2, windowMinutes: 40 }),
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.gaps.map((entry) => entry.code)).toContain('time_window');
  });
  it('reports an unmet position minimum with the position', () => {
    // 14 players on one court, everyone wants GS, but only two GS places exist per round.
    const result = generatePlan(
      plannerInput({ courts: 1, players: 14, rank1: 'GS', rank1Min: 3, rank2Min: 0, rank3Min: 0 }),
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const gap = result.gaps.find((entry) => entry.code === 'unmet_position_minimum')!;
    expect(gap.message).toContain('GS');
  });
});
