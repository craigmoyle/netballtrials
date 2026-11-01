import { describe, expect, it } from 'vitest';
import type { RoundSlotDTO } from '@netball-trials/types';
import { measureOpponentVariety } from './opponent-variety';

function game(round: number, team0: string[], team1: string[]): RoundSlotDTO[] {
  return [
    ...team0.map((registrationId, index) => ({ id: `${round}-a-${index}`, round, court: 1, position: 'GS' as const, team: 0, registrationId, playerName: registrationId, bibNumber: index + 1 })),
    ...team1.map((registrationId, index) => ({ id: `${round}-b-${index}`, round, court: 1, position: 'GA' as const, team: 1, registrationId, playerName: registrationId, bibNumber: index + 10 })),
  ];
}

describe('measureOpponentVariety', () => {
  it('lists only opponent pairs that meet more than once and includes their total meetings', () => {
    const result = measureOpponentVariety([
      ...game(1, ['a', 'b'], ['c', 'd']),
      ...game(2, ['a', 'b'], ['c', 'd']),
      ...game(3, ['a', 'b'], ['e', 'f']),
    ]);
    expect(result.repeatedPairings).toEqual([
      { playerAId: 'a', playerBId: 'c', meetings: 2 },
      { playerAId: 'a', playerBId: 'd', meetings: 2 },
      { playerAId: 'b', playerBId: 'c', meetings: 2 },
      { playerAId: 'b', playerBId: 'd', meetings: 2 },
    ]);
  });

  it('does not report single-meeting opponent pairs as repeats', () => {
    const result = measureOpponentVariety(game(1, ['a', 'b'], ['c', 'd']));
    expect(result.repeatedPairings).toEqual([]);
  });
});
