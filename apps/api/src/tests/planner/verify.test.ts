import { describe, it, expect } from 'vitest';
import { verifyPlan } from '../../planner/verify';
import { plannerInput } from '../helpers/planner';

describe('verifyPlan', () => {
  it('accepts a complete one-court plan', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0 });
    const positions = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'] as const;
    const slots = positions.flatMap((position, index) => [
      { round: 1, court: 1, position, team: 0 as const, registrationId: `p${index}` },
      { round: 1, court: 1, position, team: 1 as const, registrationId: `p${index + 7}` },
    ]);
    expect(verifyPlan(input, { rounds: 1, slots })).toEqual([]);
  });
  it('rejects a plan that double-books a player', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0 });
    const plan = {
      rounds: 1,
      slots: [
        { round: 1, court: 1, position: 'GS' as const, team: 0 as const, registrationId: 'p0' },
        { round: 1, court: 1, position: 'GA' as const, team: 0 as const, registrationId: 'p0' },
      ],
    };
    expect(verifyPlan(input, plan).map((gap) => gap.code)).toContain('no_solution');
  });
});
