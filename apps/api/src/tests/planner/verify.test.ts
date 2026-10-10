import { describe, it, expect } from 'vitest';
import { verifyPlan } from '../../planner/verify';
import { COURT_POSITIONS } from '../../planner/types';
import { plannerInput } from '../helpers/planner';

describe('verifyPlan', () => {
  it('accepts a complete one-court plan', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0 });
    const positions = COURT_POSITIONS;
    const slots = positions.flatMap((position, index) => [
      { round: 1, court: 1, position, team: 0 as const, registrationId: `p${index}` },
      { round: 1, court: 1, position, team: 1 as const, registrationId: `p${index + 7}` },
    ]);
    expect(verifyPlan(input, { rounds: 1, slots })).toEqual([]);
  });
  it.each([
    ['fractional round', (slot: any) => ({ ...slot, round: 1.5 })],
    ['out-of-range round', (slot: any) => ({ ...slot, round: 2 })],
    ['fractional court', (slot: any) => ({ ...slot, court: 1.5 })],
    ['out-of-range court', (slot: any) => ({ ...slot, court: 2 })],
    ['invalid team', (slot: any) => ({ ...slot, team: 7 })],
    ['invalid position', (slot: any) => ({ ...slot, position: 'BENCH' })],
  ])('rejects a slot with %s', (_label, mutate) => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0 });
    const positions = COURT_POSITIONS;
    const slots = positions.flatMap((position, index) => [
      { round: 1, court: 1, position, team: 0 as const, registrationId: `p${index}` },
      { round: 1, court: 1, position, team: 1 as const, registrationId: `p${index + 7}` },
    ]);
    slots[0] = mutate(slots[0]) as typeof slots[number];
    expect(verifyPlan(input, { rounds: 1, slots }).map((gap) => gap.code)).toContain('no_solution');
  });

  it('rejects an unknown registration even when the court grid is full', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0 });
    const positions = COURT_POSITIONS;
    const slots = positions.flatMap((position, index) => [
      { round: 1, court: 1, position, team: 0 as const, registrationId: `p${index}` },
      { round: 1, court: 1, position, team: 1 as const, registrationId: `p${index + 7}` },
    ]);
    slots[0] = { ...slots[0], registrationId: 'not-in-roster' };
    expect(verifyPlan(input, { rounds: 1, slots }).map((gap) => gap.code)).toContain('no_solution');
  });

  it('rejects a court with a missing position and a duplicate position', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1, rank1Min: 0, rank2Min: 0, rank3Min: 0 });
    const positions = COURT_POSITIONS;
    const slots = positions.flatMap((position, index) => [
      { round: 1, court: 1, position, team: 0 as const, registrationId: `p${index}` },
      { round: 1, court: 1, position, team: 1 as const, registrationId: `p${index + 7}` },
    ]);
    slots[0] = { ...slots[0], position: 'GA' };
    expect(verifyPlan(input, { rounds: 1, slots }).map((gap) => gap.code)).toContain('no_solution');
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
