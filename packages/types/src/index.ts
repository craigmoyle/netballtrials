export type Position = 'GS' | 'GA' | 'WA' | 'C' | 'WD' | 'GD' | 'GK';

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
  event: { name: string; eventDate?: string; venue?: string; firstWhistle?: string };
  bibNumber?: number | null;
}

export interface CheckInResult {
  result: 'checked_in' | 'already' | 'refused';
  reason?: 'not_paid' | 'unknown';
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
}

export interface RoundPlanDTO {
  id: string;
  eventId: string;
  status: 'DRAFT' | 'PUBLISHED';
  seed: number;
  rounds: number;
  playMinutes: number;
  changeoverMinutes: number;
  createdAt: string;
  publishedAt: string | null;
  slots: RoundSlotDTO[];
}

export interface PlannerGapDTO {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}
