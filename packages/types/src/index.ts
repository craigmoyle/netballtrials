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
