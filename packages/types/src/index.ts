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
  gameStartTime: string;
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

export interface PublicAssociationDTO {
  id: string;
  name: string;
  active: boolean;
}

export interface MemberAssociationDTO extends PublicAssociationDTO {
  primaryContactName: string | null;
  primaryContactEmail: string | null;
}

export interface BibColorDTO {
  id: string;
  name: string;
  hex: string;
  archivedAt: string | null;
}

export interface EventCourtColorDTO {
  court: number;
  teamAColor: BibColorDTO | null;
  teamBColor: BibColorDTO | null;
}

export type EventInput = Omit<EventDTO, 'id' | 'status' | 'policyDocumentName'>;

export interface PublicEventDTO {
  id: string;
  name: string;
  division: string;
  section: string;
  eventDate: string;
  venue: string;
  gameStartTime: string;
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

export interface PublicTrialDTO {
  id: string;
  name: string;
  division: string;
  section: string;
  eventDate: string;
  venue: string;
  startTime: string;
  gameStartTime: string;
  registrationFeeCents: number;
  currency: string;
  status: 'OPEN' | 'CLOSED';
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
  event: { name: string; eventDate: string; venue: string; startTime: string; gameStartTime: string };
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

export interface RoundPlanPlayerDTO {
  registrationId: string;
  playerName: string;
  bibNumber: number | null;
  rank1Position: Position;
  rank2Position: Position | null;
  rank3Position: Position | null;
  optInExtraPositions: boolean;
  active: boolean;
}

export interface PlanSlotInputDTO {
  round: number;
  court: number;
  position: Position;
  team: 0 | 1;
  registrationId: string;
}

export interface ManualRoundInputDTO {
  sourcePlanId: string;
  slots: PlanSlotInputDTO[];
  overrideWarnings: boolean;
}

export interface ManualSuffixInputDTO {
  sourcePlanId: string;
  fromRound: number;
  slots: PlanSlotInputDTO[];
  removedRegistrationIds: string[];
  overrideWarnings: boolean;
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
  gameStartTime: string;
  createdAt: string;
  publishedAt: string | null;
  slots: RoundSlotDTO[];
  players: RoundPlanPlayerDTO[];
  validationWarnings: PlannerGapDTO[];
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

export interface PlanRevisionSummaryDTO {
  id: string;
  revision: number;
  status: 'DRAFT' | 'PUBLISHED';
  sourcePlanId: string | null;
  frozenThroughRound: number;
  createdAt: string;
  publishedAt: string | null;
  validationWarnings: PlannerGapDTO[];
}

export interface GamePlayerDTO {
  registrationId: string;
  playerName: string;
  bibNumber: number;
  rank1Position: Position;
  rank2Position: Position | null;
  rank3Position: Position | null;
  optInExtraPositions: boolean;
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

export interface ParentRegistrationUpdateDTO {
  playerFirstName?: string;
  playerLastName?: string;
  parentName?: string;
  parentMobile?: string;
  rank1Position?: Position;
  rank2Position?: Position | null;
  rank3Position?: Position | null;
  optInExtraPositions?: boolean;
}

export type ParentCheckoutDTO = { checkoutUrl: string } | { simulationToken: string };

export interface ParentRegistrationDTO {
  id: string;
  playerFirstName: string;
  playerLastName: string;
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
  status: RegistrationStatus;
  amountCents: number;
  currency: string;
  number: number | null;
  checkedInAt: string | null;
  ageFlagged: boolean;
  createdAt: string;
  expiresAt: string;
  parentEmailVerifiedAt: string | null;
  parentFollowUpSentAt: string | null;
  canEdit: boolean;
  canWithdraw: boolean;
  canContinueCheckout: boolean;
  ticketPath: string | null;
  event: {
    id: string;
    name: string;
    eventDate: string;
    venue: string;
    startTime: string;
    gameStartTime: string;
    status: EventStatus;
  };
}

export interface IncompleteRegistrationDTO {
  id: string;
  playerName: string;
  parentEmail: string;
  status: RegistrationStatus;
  parentEmailVerified: boolean;
  startedAt: string;
  checkoutExpiresAt: string;
  followUpSentAt: string | null;
  stage: 'EMAIL_CONFIRMATION' | 'PAYMENT' | 'PAYMENT_EXPIRED';
}

export interface PlayerHistoryEntryDTO {
  registrationId: string;
  playerName: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  competitionYear: number;
  division: string;
  section: string;
  association: string;
  rank1Position: Position;
  rank2Position: Position | null;
  rank3Position: Position | null;
  registrationStatus: RegistrationStatus;
  checkedIn: boolean;
  number: number | null;
  ageFlagged: boolean;
  games: number;
  courtsSeen: number[];
  positionsPlayed: Partial<Record<Position, number>>;
  uniqueOpponents: number;
  repeatOpponentMeetings: number;
}

export interface CommunicationRecipientDTO {
  id: string;
  name: string;
  email: string;
  number: number | null;
  association: string | null;
  registrationStatus: RegistrationStatus | null;
  checkedIn: boolean | null;
  positions: Position[];
}

export interface EmailTemplateDTO {
  id: string;
  name: string;
  audience: 'participants' | 'associations';
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledMessageDTO {
  id: string;
  eventId: string;
  audience: 'participants' | 'associations';
  recipientIds: string[];
  batchId: string;
  subject: string;
  body: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'SENDING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  attempts: number;
  error: string | null;
}

export interface EmailLogDTO {
  id: string;
  registrationId: string | null;
  associationId?: string | null;
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
