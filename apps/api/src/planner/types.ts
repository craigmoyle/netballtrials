export type Position = 'GS' | 'GA' | 'WA' | 'C' | 'WD' | 'GD' | 'GK';

export const COURT_POSITIONS: Position[] = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

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
  | 'too_many_players'
  | 'unmet_position_minimum'
  | 'missing_court_visit'
  | 'time_window'
  | 'no_solution';

export interface PlannerGap {
  code: PlannerGapCode;
  message: string;
  detail?: Record<string, unknown>;
}

export type PlannerResult = { ok: true; plan: PlannerPlan } | { ok: false; gaps: PlannerGap[] };
