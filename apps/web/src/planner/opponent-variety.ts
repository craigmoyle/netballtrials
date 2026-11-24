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
  const meetingsByPlayer = new Map<string, Map<string, number>>();
  for (const { team0, team1 } of games.values()) {
    for (const playerId of team0) {
      for (const opponentId of team1) {
        const [playerAId, playerBId] = playerId < opponentId ? [playerId, opponentId] : [opponentId, playerId];
        const pairKey = JSON.stringify([playerAId, playerBId]);
        const pair = pairMeetings.get(pairKey);
        pairMeetings.set(pairKey, { playerAId, playerBId, meetings: (pair?.meetings ?? 0) + 1 });
        const playerOpponents = meetingsByPlayer.get(playerId) ?? new Map<string, number>();
        playerOpponents.set(opponentId, (playerOpponents.get(opponentId) ?? 0) + 1);
        meetingsByPlayer.set(playerId, playerOpponents);
        const opponentPlayers = meetingsByPlayer.get(opponentId) ?? new Map<string, number>();
        opponentPlayers.set(playerId, (opponentPlayers.get(playerId) ?? 0) + 1);
        meetingsByPlayer.set(opponentId, opponentPlayers);
      }
    }
  }

  return {
    byPlayer: new Map([...meetingsByPlayer].map(([id, meetings]) => [id, {
      uniqueOpponents: meetings.size,
      repeatMeetings: [...meetings.values()].reduce((total, count) => total + count - 1, 0),
    }])),
    repeatedPairs: [...pairMeetings.values()].reduce((total, pair) => total + pair.meetings - 1, 0),
    repeatedPairings: [...pairMeetings.values()].filter((pair) => pair.meetings > 1),
  };
}
