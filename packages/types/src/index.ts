export const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'] as const;
export type Position = (typeof POSITIONS)[number];

export function melbourneDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export interface AgeRange {
  minAge: number;
  maxAge: number;
}

export function defaultAgeRange(division: string): AgeRange {
  switch (division.trim().toLowerCase()) {
    case '15/u': return { minAge: 12, maxAge: 15 };
    case '17/u': return { minAge: 14, maxAge: 17 };
    case 'open': return { minAge: 15, maxAge: 99 };
    case 'all abilities': return { minAge: 10, maxAge: 99 };
    default: return { minAge: 5, maxAge: 99 };
  }
}

export type StaffRole = 'ADMIN';

export type EventStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export interface AuthUser {
  id: string;
  email: string;
  role: StaffRole;
}

export interface EventDTO {
  id: string;
  name: string;
  competitionYear: number;
  division: string;
  section: string;
  eventDate: string;
  venue: string;
  startTime: string;
  endTime: string;
  firstWhistle: string;
  lastWhistle: string;
  registrationFeeCents: number;
  courts: number;
  rank1Min: number;
  rank2Min: number;
  rank3Min: number;
  playMinutes: number;
  changeoverMinutes: number;
  minAge: number;
  maxAge: number;
  policyUrl: string | null;
  policyDocumentName: string | null;
  status: EventStatus;
}

export interface MemberAssociationDTO {
  id: string;
  name: string;
  active: boolean;
}

export type EventInput = Omit<EventDTO, 'id' | 'status' | 'policyDocumentName'>;

export interface PublicEventDTO {
  id: string;
  name: string;
  division: string;
  section: string;
  eventDate: string;
  venue: string;
  firstWhistle: string;
  startTime: string;
  competitionYear: number;
  registrationFeeCents: number;
  currency: string;
  policyUrl: string | null;
  minAge: number;
  maxAge: number;
  courts: number;
  status: EventStatus;
}

export type RegistrationStatus =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'FAILED'
  | 'WITHDRAWN';

export interface TicketDTO {
  playerName: string;
  qrCode: string;
  event: { name: string; eventDate: string; venue: string; startTime: string; firstWhistle: string };
  bibNumber?: number | null;
}

export interface CheckInResult {
  result: 'checked_in' | 'already' | 'refused';
  reason?: 'not_paid' | 'unknown';
  registrationId?: string;
  playerName?: string;
  bibNumber?: number;
  referToCommittee: boolean;
}

export interface LookupResult {
  id: string;
  playerName: string;
  bibNumber: number | null;
  checkedIn: boolean;
}

export interface CheckInSummary {
  eventId: string;
  eventName: string;
  registered: number;
  checkedIn: number;
  closed: boolean;
}

export interface RoundSlotDTO {
  id: string;
  round: number;
  court: number;
  position: Position;
  team: number;
  registrationId: string;
  playerName: string;
  bibNumber: number | null;
}

export interface RoundPlanDTO {
  id: string;
  eventId: string;
  status: 'DRAFT' | 'PUBLISHED';
  revision: number;
  sourcePlanId: string | null;
  frozenThroughRound: number;
  seed: number;
  rounds: number;
  courts: number;
  playMinutes: number;
  changeoverMinutes: number;
  windowMinutes: number;
  rank1Min: number;
  rank2Min: number;
  rank3Min: number;
  eventName: string;
  eventDate: string;
  venue: string;
  firstWhistle: string;
  createdAt: string;
  publishedAt: string | null;
  slots: RoundSlotDTO[];
}

export interface PlannerPreviewDTO {
  checkedInPlayers: number;
  minimumRounds: number;
  requiredMinutes: number;
  windowMinutes: number;
  fitsTimeWindow: boolean;
}

export interface PlannerGapDTO {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ReviewItemDTO {
  id: string;
  reason: string;
  note: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionHistory?: unknown | null;
  registration: {
    id: string;
    playerName: string;
    bibNumber: number | null;
    ageFlagged: boolean;
  };
}

export interface RosterRegistrationDTO {
  id: string;
  playerName: string;
  dateOfBirth: string;
  parentName: string;
  parentEmail: string;
  parentMobile: string;
  memberAssociation: string;
  rank1Position: Position;
  rank2Position: Position | null;
  rank3Position: Position | null;
  optInExtraPositions: boolean;
  ageFlagged: boolean;
  status: RegistrationStatus;
  amountCents: number;
  currency: string;
  bibNumber: number | null;
  checkedInAt: string | null;
}

export interface RosterDTO {
  eventId: string;
  registrations: RosterRegistrationDTO[];
  positionCounts: {
    rank1: Partial<Record<Position, number>>;
    rank2: Partial<Record<Position, number>>;
    rank3: Partial<Record<Position, number>>;
    extraOptIn: number;
  };
}

export interface EmailLogDTO {
  id: string;
  registrationId: string | null;
  senderUserId: string | null;
  batchId: string;
  to: string;
  subject: string;
  body: string;
  kind: string;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'AMBIGUOUS' | 'ANONYMIZED';
  attempts: number;
  createdAt: string;
  lastAttemptAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  error: string | null;
}
