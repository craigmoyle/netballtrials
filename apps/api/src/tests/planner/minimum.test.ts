import { describe, it, expect } from 'vitest';
import { computeMinimumRounds, totalTimeMinutes } from '../../planner/minimum';
import { player } from '../helpers/planner';

describe('computeMinimumRounds', () => {
  it('is the largest of courts, players over 14, and the quota bound', () => {
    const players = Array.from({ length: 71 }, (_, i) => player(`p${i}`, 'GS', 'WA', 'WD'));
    expect(computeMinimumRounds({ courts: 5, rank1Min: 2, rank2Min: 1, rank3Min: 1, players })).toBe(6);
    expect(computeMinimumRounds({ courts: 5, rank1Min: 1, rank2Min: 0, rank3Min: 0, players })).toBe(6);
  });
  it('is at least the court count with few players', () => {
    const players = Array.from({ length: 28 }, (_, i) => player(`p${i}`, 'GS', null, null));
    expect(computeMinimumRounds({ courts: 3, rank1Min: 2, rank2Min: 0, rank3Min: 0, players })).toBe(3);
  });
});

describe('totalTimeMinutes', () => {
  it('adds one changeover between each pair of rounds', () => {
    expect(totalTimeMinutes(6, 8, 2)).toBe(58);
    expect(totalTimeMinutes(1, 8, 2)).toBe(8);
  });
});
