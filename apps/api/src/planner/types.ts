import { POSITIONS as COURT_POSITIONS } from '@netball-trials/types';
import type { Position } from '@netball-trials/types';

export { COURT_POSITIONS };
export type { Position };

export type TeamIndex = 0 | 1;

export interface PlannerPlayer {
  registrationId: string;
  name: string;
  bibNumber: number;
  rank1: Position;
  rank2: Position | null;
  rank3: Position | null;
  optInExtra: boolean;
}

export interface PlannerInput {
  courts: number;
  rounds: number;
  playMinutes: number;
  changeoverMinutes: number;
  windowMinutes: number;
  rank1Min: number;
  rank2Min: number;
  rank3Min: number;
  players: PlannerPlayer[];
  inactiveRegistrationIds?: string[];
  frozenThroughRound?: number;
}

export interface PlanSlot {
  round: number;
  court: number;
  position: Position;
  team: TeamIndex;
  registrationId: string;
}

export interface PlannerPlan {
  rounds: number;
  slots: PlanSlot[];
}

export type PlannerGapCode =
  | 'too_few_players'
  | 'unmet_position_minimum'
  | 'missing_court_visit'
  | 'position_preference_warning'
  | 'game_count_fairness_warning'
  | 'time_window'
  | 'no_solution';

export interface PlannerGap {
  code: PlannerGapCode;
  message: string;
  detail?: Record<string, unknown>;
}

export type PlannerResult = { ok: true; plan: PlannerPlan } | { ok: false; gaps: PlannerGap[] };
