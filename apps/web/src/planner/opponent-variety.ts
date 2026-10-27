import type { RoundSlotDTO } from '@netball-trials/types';

export function measureOpponentVariety(slots: RoundSlotDTO[]) {
  const games = new Map<string, { team0: string[]; team1: string[] }>();
  for (const slot of slots) {
    const key = `${slot.round}:${slot.court}`;
    const game = games.get(key) ?? { team0: [], team1: [] };
    (slot.team === 0 ? game.team0 : game.team1).push(slot.registrationId);
    games.set(key, game);
  }

  const byPlayer = new Map<string, Map<string, number>>();
  const pairMeetings = new Map<string, number>();
  for (const { team0, team1 } of games.values()) {
    for (const playerId of team0) {
      for (const opponentId of team1) {
        const opponents = byPlayer.get(playerId) ?? new Map<string, number>();
        opponents.set(opponentId, (opponents.get(opponentId) ?? 0) + 1);
        byPlayer.set(playerId, opponents);
        const reverse = byPlayer.get(opponentId) ?? new Map<string, number>();
        reverse.set(playerId, (reverse.get(playerId) ?? 0) + 1);
        byPlayer.set(opponentId, reverse);
        const pair = [playerId, opponentId].sort().join('|');
        pairMeetings.set(pair, (pairMeetings.get(pair) ?? 0) + 1);
      }
    }
  }

  return {
    byPlayer: new Map([...byPlayer].map(([id, meetings]) => [id, {
      uniqueOpponents: meetings.size,
      repeatMeetings: [...meetings.values()].reduce((total, count) => total + count - 1, 0),
    }])),
    repeatedPairs: [...pairMeetings.values()].reduce((total, count) => total + count - 1, 0),
  };
}
