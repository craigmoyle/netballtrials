import { Prisma, type PrismaClient, type Position } from '@prisma/client';
import { melbourneDateKey, type AdminRegistrationCorrectionDTO, type RosterDTO, type RosterRegistrationDTO } from '@netball-trials/types';
import { ageAtDecember31, isAgeInRange } from '../registrations/eligibility';
import { isPastRetentionCutoff } from '../retention/service';
import { appendRosterSnapshot } from './snapshots';

const ACTIVE_STATUSES = ['PENDING', 'PAID'] as const;

function countPositions(rows: Array<{ rank1Position: Position; rank2Position: Position | null; rank3Position: Position | null; optInExtraPositions: boolean }>) {
  const count = (rank: 'rank1Position' | 'rank2Position' | 'rank3Position') =>
    rows.reduce<Partial<Record<Position, number>>>((counts, row) => {
      const position = row[rank];
      if (position) counts[position] = (counts[position] ?? 0) + 1;
      return counts;
    }, {});
  return {
    rank1: count('rank1Position'),
    rank2: count('rank2Position'),
    rank3: count('rank3Position'),
    extraOptIn: rows.filter((row) => row.optInExtraPositions).length,
  };
}

type RosterRegistrationRow = {
  id: string;
  playerFirstName: string;
  playerLastName: string;
  dateOfBirth: Date;
  parentName: string;
  parentEmail: string;
  parentMobile: string;
  memberAssociation: string;
  rank1Position: Position;
  rank2Position: Position | null;
  rank3Position: Position | null;
  optInExtraPositions: boolean;
  ageFlagged: boolean;
  status: RosterRegistrationDTO['status'];
  amountCents: number;
  currency: string;
  bibNumber: number | null;
  checkedInAt: Date | null;
  adminAssistedAt: Date | null;
  duplicateOfRegistrationId: string | null;
  removedAt: Date | null;
  removalReason: string | null;
  removalNote: string | null;
};

function toRosterRegistration(row: RosterRegistrationRow): RosterRegistrationDTO {
  return {
    id: row.id,
    playerName: [row.playerFirstName, row.playerLastName].filter(Boolean).join(' '),
    dateOfBirth: row.dateOfBirth.toISOString().slice(0, 10),
    parentName: row.parentName,
    parentEmail: row.parentEmail,
    parentMobile: row.parentMobile,
    memberAssociation: row.memberAssociation,
    rank1Position: row.rank1Position,
    rank2Position: row.rank2Position,
    rank3Position: row.rank3Position,
    optInExtraPositions: row.optInExtraPositions,
    ageFlagged: row.ageFlagged,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    // A number remains assigned across an undo so it is still visible in roster and contact lists.
    bibNumber: row.bibNumber,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    adminAssistedAt: row.adminAssistedAt?.toISOString() ?? null,
    duplicateOfRegistrationId: row.duplicateOfRegistrationId,
    removedAt: row.removedAt?.toISOString() ?? null,
    removalReason: row.removalReason,
    removalNote: row.removalNote,
  };
}

export class RosterCorrectionError extends Error {
  constructor(
    readonly code: 'not_found' | 'duplicate_player' | 'validation_failed' | 'ineligible',
    readonly fields: string[] = [],
    readonly policy?: { competitionYear: number; minAge: number; maxAge: number },
  ) {
    super(code);
    this.name = 'RosterCorrectionError';
  }
}

export async function correctRegistration(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  patch: Omit<AdminRegistrationCorrectionDTO, 'reason'>,
  now = new Date(),
  audit: { actorUserId?: string; reason?: string } = {},
): Promise<RosterRegistrationDTO> {
  return prisma.$transaction(async (tx) => {
    const events = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
    `);
    if (events.length === 0) throw new RosterCorrectionError('not_found');

    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Registration" WHERE "id" = ${registrationId} AND "eventId" = ${eventId} FOR UPDATE
    `);
    const registration = await tx.registration.findFirst({
      where: { id: registrationId, eventId, anonymizedAt: null },
      include: { policySnapshot: true },
    });
    if (!registration || isPastRetentionCutoff(event.eventDate, now)) throw new RosterCorrectionError('not_found');

    const dateOfBirthKey = patch.dateOfBirth ?? registration.dateOfBirth.toISOString().slice(0, 10);
    if (dateOfBirthKey > melbourneDateKey(now)) throw new RosterCorrectionError('validation_failed', ['dateOfBirth']);
    const dateOfBirth = new Date(`${dateOfBirthKey}T00:00:00.000Z`);
    const memberAssociation = patch.memberAssociation ?? registration.memberAssociation;
    if (patch.memberAssociation !== undefined) {
      const active = await tx.memberAssociation.findFirst({ where: { name: memberAssociation, active: true }, select: { id: true } });
      if (!active) throw new RosterCorrectionError('validation_failed', ['memberAssociation']);
    }

    if (ACTIVE_STATUSES.includes(registration.status as (typeof ACTIVE_STATUSES)[number])) {
      const duplicate = await tx.registration.findFirst({
        where: {
          eventId,
          playerNameNormalized: registration.playerNameNormalized,
          dateOfBirth,
          status: { in: [...ACTIVE_STATUSES] },
          anonymizedAt: null,
          id: { not: registration.id },
        },
        select: { id: true },
      });
      if (duplicate) throw new RosterCorrectionError('duplicate_player');
    }

    const policy = registration.policySnapshot ?? event;
    const age = ageAtDecember31(dateOfBirth, policy.competitionYear);
    if (!isAgeInRange(age, policy.minAge, policy.maxAge)) {
      throw new RosterCorrectionError('ineligible', [], {
        competitionYear: policy.competitionYear, minAge: policy.minAge, maxAge: policy.maxAge,
      });
    }
    const values = { dateOfBirth, memberAssociation, ageFlagged: false };
    const changeData: Record<string, { from: string | boolean; to: string | boolean }> = {};
    if (dateOfBirthKey !== registration.dateOfBirth.toISOString().slice(0, 10)) {
      changeData.dateOfBirth = { from: registration.dateOfBirth.toISOString().slice(0, 10), to: dateOfBirthKey };
    }
    if (memberAssociation !== registration.memberAssociation) {
      changeData.memberAssociation = { from: registration.memberAssociation, to: memberAssociation };
    }
    if (registration.ageFlagged) changeData.ageFlagged = { from: registration.ageFlagged, to: false };
    const changedFields = Object.keys(changeData);
    if (changedFields.length === 0) return toRosterRegistration(registration);

    const updated = await tx.registration.update({ where: { id: registration.id }, data: values });
    await tx.registrationChangeLog.create({
      data: {
        registrationId: registration.id,
        actorType: 'ADMIN',
        changedFields,
        changeData: changeData as Prisma.InputJsonObject,
      },
    });
    await tx.auditEvent.create({ data: {
      eventId, registrationId, actorType: 'ADMIN', actorUserId: audit.actorUserId,
      action: 'REGISTRATION_CORRECTED', entityType: 'Registration', entityId: registrationId,
      reason: audit.reason ?? 'Registration details corrected by Admin',
      beforeState: { dateOfBirth: registration.dateOfBirth.toISOString().slice(0, 10), memberAssociation: registration.memberAssociation },
      afterState: { dateOfBirth: dateOfBirthKey, memberAssociation }, createdAt: now,
    } });
    return toRosterRegistration(updated);
  });
}

export const REMOVAL_REASONS = [
  'Duplicate', 'Unable to attend', 'Late withdrawal', 'Ineligible correction', 'Did not arrive', 'Other',
] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export class RosterMutationError extends Error {
  constructor(readonly code: 'not_found' | 'already_removed' | 'invalid_duplicate') {
    super(code);
    this.name = 'RosterMutationError';
  }
}

function mutationState(registration: RegistrationState) {
  return {
    status: registration.status,
    checkedInAt: registration.checkedInAt?.toISOString() ?? null,
    bibNumber: registration.bibNumber,
    removedAt: registration.removedAt?.toISOString() ?? null,
    removalReason: registration.removalReason,
    duplicateOfRegistrationId: registration.duplicateOfRegistrationId,
  };
}

type RegistrationState = Prisma.RegistrationGetPayload<{}>;

async function afterRosterMutation(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  if (await tx.rosterSnapshot.count({ where: { eventId } }) > 0) await appendRosterSnapshot(tx, eventId);
}

export async function removeFromRoster(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  input: { reason: RemovalReason; note: string | null },
  actorUserId: string,
  now = new Date(),
): Promise<RegistrationState> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    if (locked.length === 0) throw new RosterMutationError('not_found');
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Registration" WHERE "id" = ${registrationId} AND "eventId" = ${eventId} FOR UPDATE`);
    const registration = await tx.registration.findFirst({ where: { id: registrationId, eventId, anonymizedAt: null } });
    if (!registration) throw new RosterMutationError('not_found');
    if (registration.removedAt || registration.status === 'WITHDRAWN' || registration.status === 'DUPLICATE') {
      throw new RosterMutationError('already_removed');
    }
    const updated = await tx.registration.update({
      where: { id: registrationId },
      data: {
        status: 'WITHDRAWN', removedAt: now, removalReason: input.reason,
        removalNote: input.note?.trim() || null,
      },
    });
    await tx.auditEvent.create({
      data: {
        eventId, registrationId, actorType: 'ADMIN', actorUserId,
        action: 'REGISTRATION_REMOVED', entityType: 'Registration', entityId: registrationId,
        reason: input.reason, beforeState: mutationState(registration), afterState: mutationState(updated),
        metadata: input.note ? { note: input.note } : undefined,
        createdAt: now,
      },
    });
    await afterRosterMutation(tx, eventId);
    return updated;
  });
}

export async function markRegistrationDuplicate(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  duplicateOfRegistrationId: string,
  input: { note: string | null },
  actorUserId: string,
  now = new Date(),
): Promise<RegistrationState> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    if (locked.length === 0) throw new RosterMutationError('not_found');
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    const registrations = await tx.registration.findMany({
      where: { id: { in: [registrationId, duplicateOfRegistrationId] }, eventId, anonymizedAt: null },
      orderBy: { id: 'asc' },
      include: { policySnapshot: true },
    });
    const registration = registrations.find((row) => row.id === registrationId);
    const retained = registrations.find((row) => row.id === duplicateOfRegistrationId);
    if (!registration) throw new RosterMutationError('not_found');
    const retainedPolicy = retained?.policySnapshot ?? event;
    if (!retained || retained.id === registration.id || retained.removedAt || registration.removedAt ||
      !ACTIVE_STATUSES.includes(retained.status as (typeof ACTIVE_STATUSES)[number]) ||
      registration.status === 'DUPLICATE' || registration.status === 'WITHDRAWN' || retained.ageFlagged ||
      !isAgeInRange(ageAtDecember31(retained.dateOfBirth, retainedPolicy.competitionYear), retainedPolicy.minAge, retainedPolicy.maxAge) ||
      retained.playerNameNormalized !== registration.playerNameNormalized ||
      retained.dateOfBirth.getTime() !== registration.dateOfBirth.getTime()) {
      throw new RosterMutationError('invalid_duplicate');
    }
    const updated = await tx.registration.update({
      where: { id: registrationId },
      data: {
        status: 'DUPLICATE', duplicateOfRegistrationId, removedAt: now,
        removalReason: 'Duplicate', removalNote: input.note?.trim() || null,
      },
    });
    await tx.auditEvent.create({
      data: {
        eventId, registrationId, actorType: 'ADMIN', actorUserId,
        action: 'REGISTRATION_MARKED_DUPLICATE', entityType: 'Registration', entityId: registrationId,
        reason: 'Duplicate', beforeState: mutationState(registration), afterState: mutationState(updated),
        metadata: { duplicateOfRegistrationId, ...(input.note ? { note: input.note } : {}) },
        createdAt: now,
      },
    });
    await afterRosterMutation(tx, eventId);
    return updated;
  });
}

export async function getRoster(prisma: PrismaClient, eventId: string, now = new Date()): Promise<RosterDTO | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, eventDate: true } });
  if (!event || isPastRetentionCutoff(event.eventDate, now)) return null;
  const rows = await prisma.registration.findMany({
    where: { eventId, anonymizedAt: null },
    orderBy: [{ playerLastName: 'asc' }, { playerFirstName: 'asc' }],
    select: {
      id: true, playerFirstName: true, playerLastName: true, dateOfBirth: true,
      parentName: true, parentEmail: true, parentMobile: true, memberAssociation: true,
      rank1Position: true, rank2Position: true, rank3Position: true, optInExtraPositions: true,
      ageFlagged: true, status: true, amountCents: true, currency: true, bibNumber: true, checkedInAt: true,
      adminAssistedAt: true, duplicateOfRegistrationId: true, removedAt: true, removalReason: true, removalNote: true,
    },
  });
  const activeRows = rows.filter((row) => ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number]));
  const registrations = rows.map(toRosterRegistration);
  return { eventId, registrations, positionCounts: countPositions(activeRows) };
}

function csvCell(value: string | number | boolean | null): string {
  let raw = value === null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(raw)) raw = `'${raw}`;
  return `"${raw.replaceAll('"', '""')}"`;
}

const CSV_HEADERS = [
  'Player name', 'Date of birth', 'Parent/guardian', 'Email', 'Mobile', 'Association',
  'Rank 1', 'Rank 2', 'Rank 3', 'Opt in to extra positions', 'Review flagged',
  'Registration status', 'Amount (cents)', 'Currency', 'Number', 'Checked in at',
];

export async function exportRosterCsv(
  prisma: PrismaClient,
  eventId: string,
  now = new Date(),
): Promise<{ csv: string; filename: string } | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, eventDate: true } });
  if (!event || isPastRetentionCutoff(event.eventDate, now)) return null;
  const roster = await getRoster(prisma, eventId, now);
  if (!roster) return null;
  const rows = [CSV_HEADERS, ...roster.registrations.map((row) => [
    row.playerName, row.dateOfBirth, row.parentName, row.parentEmail, row.parentMobile, row.memberAssociation,
    row.rank1Position, row.rank2Position, row.rank3Position, row.optInExtraPositions, row.ageFlagged,
    row.status, row.amountCents, row.currency, row.bibNumber, row.checkedInAt,
  ])];
  return {
    csv: `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
    filename: `roster-${event.id}.csv`,
  };
}
