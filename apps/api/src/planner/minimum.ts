import type { PlannerInput, PlannerPlayer } from './types';

export function totalTimeMinutes(
  rounds: number,
  playMinutes: number,
  changeoverMinutes: number,
): number {
  return rounds * playMinutes + Math.max(0, rounds - 1) * changeoverMinutes;
}

type QuotaConfig = Pick<PlannerInput, 'rank1Min' | 'rank2Min' | 'rank3Min'>;

function requiredAppearances(player: PlannerPlayer, quota: QuotaConfig): number {
  return (
    quota.rank1Min +
    (player.rank2 ? quota.rank2Min : 0) +
    (player.rank3 ? quota.rank3Min : 0)
  );
}

export function computeMinimumRounds(
  input: Pick<PlannerInput, 'courts' | 'rank1Min' | 'rank2Min' | 'rank3Min' | 'players'>,
): number {
  const capacityPerRound = input.courts * 14;
  const totalRequired = input.players.reduce(
    (sum, player) => sum + requiredAppearances(player, input),
    0,
  );
  const quotaBound = Math.ceil(totalRequired / capacityPerRound);
  const maxIndividual = input.players.reduce(
    (max, player) => Math.max(max, requiredAppearances(player, input)),
    0,
  );

  return Math.max(
    input.courts,
    Math.ceil(input.players.length / 14),
    quotaBound,
    maxIndividual,
    1,
  );
}
