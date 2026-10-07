import type { PlannerInput, PlannerPlayer, Position } from '../../planner/types';

export function player(
  id: string,
  rank1: Position,
  rank2: Position | null,
  rank3: Position | null,
  opts: { optInExtra?: boolean; bib?: number } = {},
): PlannerPlayer {
  return {
    registrationId: id,
    name: `Player ${id}`,
    bibNumber: opts.bib ?? 0,
    rank1,
    rank2,
    rank3,
    optInExtra: opts.optInExtra ?? true,
  };
}

const POSITIONS: Position[] = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

export function plannerInput(input: {
  courts: number;
  players: number | PlannerPlayer[];
  rounds?: number;
  playMinutes?: number;
  changeoverMinutes?: number;
  windowMinutes?: number;
  rank1?: Position;
  rank2?: Position | null;
  rank3?: Position | null;
  rank1Min?: number;
  rank2Min?: number;
  rank3Min?: number;
}): PlannerInput {
  const players =
    typeof input.players === 'number'
      ? Array.from({ length: input.players }, (_, index) =>
          player(
            `p${index}`,
            input.rank1 ?? POSITIONS[index % POSITIONS.length],
            input.rank2 ?? null,
            input.rank3 ?? null,
            { bib: index + 1 },
          ),
        )
      : input.players;

  const courts = input.courts;

  return {
    courts,
    rounds: input.rounds ?? Math.max(courts, Math.ceil(players.length / 14)),
    playMinutes: input.playMinutes ?? 8,
    changeoverMinutes: input.changeoverMinutes ?? 2,
    windowMinutes: input.windowMinutes ?? 600,
    rank1Min: input.rank1Min ?? 1,
    rank2Min: input.rank2Min ?? 0,
    rank3Min: input.rank3Min ?? 0,
    players,
  };
}
