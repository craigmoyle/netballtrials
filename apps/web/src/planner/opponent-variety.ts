import type { RoundSlotDTO } from '@netball-trials/types';

export function measureOpponentVariety(slots: RoundSlotDTO[]) {
  const games = new Map<string, { team0: string[]; team1: string[] }>();
  for (const slot of slots) {
    const key = `${slot.round}:${slot.court}`;
    const game = games.get(key) ?? { team0: [], team1: [] };
    (slot.team === 0 ? game.team0 : game.team1).push(slot.registrationId);
    games.set(key, game);
  }

  const pairMeetings = new Map<string, { playerAId: string; playerBId: string; meetings: number }>();
  for (const { team0, team1 } of games.values()) {
    for (const playerId of team0) {
      for (const opponentId of team1) {
        const [playerAId, playerBId] = playerId < opponentId ? [playerId, opponentId] : [opponentId, playerId];
        const pairKey = JSON.stringify([playerAId, playerBId]);
        const pair = pairMeetings.get(pairKey);
        pairMeetings.set(pairKey, { playerAId, playerBId, meetings: (pair?.meetings ?? 0) + 1 });
      }
    }
  }

  return { repeatedPairings: [...pairMeetings.values()].filter((pair) => pair.meetings > 1) };
}
