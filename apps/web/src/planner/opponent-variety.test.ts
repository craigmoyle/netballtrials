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
  it('counts unique opponents and repeat meetings per player and across the plan', () => {
    const result = measureOpponentVariety([
      ...game(1, ['a', 'b'], ['c', 'd']),
      ...game(2, ['a', 'b'], ['c', 'd']),
      ...game(3, ['a', 'b'], ['e', 'f']),
    ]);
    expect(result.byPlayer.get('a')).toEqual({ uniqueOpponents: 4, repeatMeetings: 2 });
    expect(result.byPlayer.get('c')).toEqual({ uniqueOpponents: 2, repeatMeetings: 2 });
    expect(result.repeatedPairs).toBe(4);
  });

  it('does not count teammates as opponents and returns zero for a player without games', () => {
    const result = measureOpponentVariety(game(1, ['a', 'b'], ['c', 'd']));
    expect(result.byPlayer.get('a')?.uniqueOpponents).toBe(2);
    expect(result.byPlayer.get('a')?.uniqueOpponents).not.toBe(3);
    expect(result.byPlayer.has('resting-player')).toBe(false);
    expect(result.repeatedPairs).toBe(0);
  });
});
