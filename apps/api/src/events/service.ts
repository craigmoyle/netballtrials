import { createHash } from 'node:crypto';
import { Prisma, type Event, type PrismaClient } from '@prisma/client';
import { DEFAULT_POLICY_URL } from '../policy';
import { ageAtDecember31, isAgeInRange } from '../registrations/eligibility';
import { localDateTimeToUtc } from '../time/melbourne';
import {
  EventValidationError,
  annualCloneInputSchema,
  eventInputSchema,
  eventPatchSchema,
  registrationDeadlineToDate,
  validateWindow,
  type AnnualCloneInput,
  type EventInput,
  type EventPatch,
  type ValidAnnualCloneInput,
  type ValidEventInput,
} from './schemas';

function toEventData(input: ValidEventInput) {
  return {
    name: input.name,
    competitionYear: input.competitionYear,
    division: input.division,
    section: input.section,
    eventDate: new Date(`${input.eventDate}T00:00:00.000Z`),
    venue: input.venue,
    startTime: input.startTime,
    endTime: input.endTime,
    gameStartTime: input.gameStartTime,
    registrationClosesAt: input.registrationClosesAt,
    registrationFeeCents: input.registrationFeeCents,
    courts: input.courts,
    rank1Min: input.rank1Min,
    rank2Min: input.rank2Min,
    rank3Min: input.rank3Min,
    playMinutes: input.playMinutes,
    changeoverMinutes: input.changeoverMinutes,
    minAge: input.minAge,
    maxAge: input.maxAge,
    policyUrl: input.policyUrl ?? DEFAULT_POLICY_URL,
  };
}

function assertValid(input: unknown): ValidEventInput {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new EventValidationError(parsed.error.issues.map((issue) => String(issue.path[0])));
  }

  const windowErrors = validateWindow(parsed.data);
  if (windowErrors.length > 0) {
    throw new EventValidationError(windowErrors);
  }
  if (parsed.data.minAge > parsed.data.maxAge) {
    throw new EventValidationError(['maxAge']);
  }

  return parsed.data;
}

/** Event shape safe to return from the API: never includes the check-in PIN hash. */
export type EventResponse = Omit<Event, 'checkInPinHash'>;
const omitSecrets = { checkInPinHash: true } as const;

export class EventLifecycleError extends Error {
  constructor(readonly code: 'invalid_transition' | 'confirmation_required' | 'deadline_required' = 'invalid_transition') {
    super(code);
    this.name = 'EventLifecycleError';
  }
}

export async function createEvent(
  prisma: PrismaClient,
  input: EventInput,
  options: { actorUserId?: string; reason?: string; now?: Date } = {},
): Promise<EventResponse> {
  const valid = assertValid(input);
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({ data: toEventData(valid), omit: omitSecrets });
    await tx.auditEvent.create({ data: {
      eventId: event.id, actorType: 'ADMIN', actorUserId: options.actorUserId,
      action: 'EVENT_CREATED', entityType: 'Event', entityId: event.id,
      reason: options.reason ?? 'Created event', afterState: { status: event.status }, createdAt: options.now,
    } });
    return event;
  });
}

export async function listEvents(prisma: PrismaClient): Promise<EventResponse[]> {
  return prisma.event.findMany({ orderBy: [{ eventDate: 'asc' }, { name: 'asc' }], omit: omitSecrets });
}

export async function getEvent(prisma: PrismaClient, id: string): Promise<EventResponse | null> {
  return prisma.event.findUnique({ where: { id }, omit: omitSecrets });
}

export async function updateEvent(
  prisma: PrismaClient,
  id: string,
  patch: EventPatch,
  options: { actorUserId?: string; now?: Date; reason?: string } = {},
): Promise<EventResponse | null> {
  return prisma.$transaction(async (tx) => {
    // Lock the row first so concurrent edits merge onto the latest values instead of a stale read.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
    if (locked.length !== 1) return null;
    const existing = await tx.event.findUniqueOrThrow({ where: { id } });

    const parsedPatch = eventPatchSchema.safeParse(patch);
    if (!parsedPatch.success) {
      throw new EventValidationError(parsedPatch.error.issues.map((issue) => String(issue.path[0])));
    }

    const merged = {
      name: existing.name,
      competitionYear: existing.competitionYear,
      division: existing.division,
      section: existing.section,
      eventDate: existing.eventDate.toISOString().slice(0, 10),
      venue: existing.venue,
      startTime: existing.startTime,
      endTime: existing.endTime,
      gameStartTime: existing.gameStartTime,
      registrationClosesAt: existing.registrationClosesAt.toISOString(),
      registrationFeeCents: existing.registrationFeeCents,
      courts: existing.courts,
      rank1Min: existing.rank1Min,
      rank2Min: existing.rank2Min,
      rank3Min: existing.rank3Min,
      playMinutes: existing.playMinutes,
      changeoverMinutes: existing.changeoverMinutes,
      minAge: existing.minAge,
      maxAge: existing.maxAge,
      ...parsedPatch.data,
      policyUrl: parsedPatch.data.policyUrl === null
        ? DEFAULT_POLICY_URL
        : parsedPatch.data.policyUrl ?? existing.policyUrl ?? DEFAULT_POLICY_URL,
    };
    const valid = assertValid(merged);
    const deadlineChanged = valid.registrationClosesAt.getTime() !== existing.registrationClosesAt.getTime();
    if (deadlineChanged && (existing.status === 'CLOSED' || existing.registrationClosedAt ||
      (existing.status === 'OPEN' && existing.registrationClosesAt.getTime() <= (options.now ?? new Date()).getTime()))) {
      throw new EventLifecycleError('confirmation_required');
    }
    const ageSettingsChanged = valid.competitionYear !== existing.competitionYear ||
      valid.minAge !== existing.minAge || valid.maxAge !== existing.maxAge;
    const policySettingsChanged = ageSettingsChanged || valid.policyUrl !== (existing.policyUrl ?? DEFAULT_POLICY_URL);
    if (policySettingsChanged && (existing.status === 'OPEN' ||
      await tx.eventPolicySnapshot.count({ where: { eventId: id } }) > 0)) {
      throw new EventLifecycleError('invalid_transition');
    }

    const updated = await tx.event.update({ where: { id }, data: toEventData(valid), omit: omitSecrets });
    if (deadlineChanged) await tx.auditEvent.create({ data: {
      eventId: id, actorType: options.actorUserId ? 'ADMIN' : 'SYSTEM', actorUserId: options.actorUserId,
      action: 'REGISTRATION_DEADLINE_CHANGED', entityType: 'Event', entityId: id, reason: options.reason ?? 'Registration deadline changed',
      beforeState: { registrationClosesAt: existing.registrationClosesAt },
      afterState: { registrationClosesAt: valid.registrationClosesAt },
    } });
    if (policySettingsChanged) await tx.auditEvent.create({ data: {
      eventId: id, actorType: options.actorUserId ? 'ADMIN' : 'SYSTEM', actorUserId: options.actorUserId,
      action: 'EVENT_POLICY_CHANGED', entityType: 'Event', entityId: id,
      reason: options.reason ?? 'Event eligibility policy changed',
      beforeState: { competitionYear: existing.competitionYear, minAge: existing.minAge, maxAge: existing.maxAge, policyUrl: existing.policyUrl },
      afterState: { competitionYear: valid.competitionYear, minAge: valid.minAge, maxAge: valid.maxAge, policyUrl: valid.policyUrl },
    } });
    await tx.auditEvent.create({ data: {
      eventId: id, actorType: options.actorUserId ? 'ADMIN' : 'SYSTEM', actorUserId: options.actorUserId,
      action: 'EVENT_UPDATED', entityType: 'Event', entityId: id, reason: options.reason ?? 'Updated event details',
      beforeState: { name: existing.name, status: existing.status, registrationClosesAt: existing.registrationClosesAt.toISOString() },
      afterState: { name: updated.name, status: updated.status, registrationClosesAt: updated.registrationClosesAt.toISOString() },
    } });
    if (ageSettingsChanged && existing.status === 'DRAFT') {
      const registrations = await tx.registration.findMany({
        where: { eventId: id, status: { in: ['PENDING', 'PAID'] } },
        select: { id: true, dateOfBirth: true },
      });
      const flagged: string[] = [];
      const unflagged: string[] = [];
      for (const registration of registrations) {
        const age = ageAtDecember31(registration.dateOfBirth, valid.competitionYear);
        (isAgeInRange(age, valid.minAge, valid.maxAge) ? unflagged : flagged).push(registration.id);
      }
      if (flagged.length > 0) {
        await tx.registration.updateMany({ where: { id: { in: flagged }, ageFlagged: false }, data: { ageFlagged: true } });
      }
      if (unflagged.length > 0) {
        await tx.registration.updateMany({ where: { id: { in: unflagged }, ageFlagged: true }, data: { ageFlagged: false } });
      }
    }
    return updated;
  });
}

type LifecycleOptions = {
  actorUserId?: string;
  now?: Date;
  registrationClosesAt?: string;
  confirmReopen?: boolean;
  reason?: string;
  policySnapshotBaseUrl?: string;
};

function policySnapshotUrl(baseUrl: string, eventId: string, version: number): string {
  return `${baseUrl.replace(/\/$/, '')}/api/public/events/${eventId}/policy-snapshots/${version}`;
}

export async function openEvent(
  prisma: PrismaClient,
  id: string,
  options: LifecycleOptions = {},
): Promise<EventResponse | null> {
  const now = options.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
    if (locked.length !== 1) return null;
    const event = await tx.event.findUniqueOrThrow({ where: { id }, include: { policyDocument: true } });
    const reopening = event.status === 'CLOSED' ||
      (event.status === 'OPEN' && event.registrationClosesAt.getTime() <= now.getTime());
    const deadline = options.registrationClosesAt
      ? assertDeadline(options.registrationClosesAt)
      : event.registrationClosesAt;
    if (deadline.getTime() <= now.getTime()) throw new EventLifecycleError('deadline_required');
    assertDeadlineBeforeStart({ eventDate: event.eventDate, startTime: event.startTime }, deadline);
    if (reopening && (!options.confirmReopen || !options.registrationClosesAt)) throw new EventLifecycleError('confirmation_required');
    if (event.status === 'OPEN' && !options.registrationClosesAt) return getEvent(prisma, id);

    const shouldCaptureSnapshot = event.status === 'DRAFT' || event.status === 'CLOSED';
    const previousVersion = shouldCaptureSnapshot ? (await tx.eventPolicySnapshot.aggregate({
      where: { eventId: id }, _max: { version: true },
    }))._max.version ?? 0 : 0;
    const snapshotVersion = previousVersion + 1;
    const documentBytes = event.policyDocument?.bytes ?? null;
    const snapshot = shouldCaptureSnapshot ? await tx.eventPolicySnapshot.create({
      data: {
        eventId: id,
        version: snapshotVersion,
        policyReference: policySnapshotUrl(options.policySnapshotBaseUrl ?? '', id, snapshotVersion),
        competitionYear: event.competitionYear,
        minAge: event.minAge,
        maxAge: event.maxAge,
        policyUrl: event.policyUrl,
        policyDocumentName: event.policyDocument?.fileName ?? null,
        policyDocumentBytes: documentBytes,
        policyDocumentHash: documentBytes ? createHash('sha256').update(Buffer.from(documentBytes)).digest('hex') : null,
      },
    }) : null;
    const updated = await tx.event.update({
      where: { id },
      data: { status: 'OPEN', registrationClosesAt: deadline, registrationClosedAt: null },
      omit: omitSecrets,
    });
    await tx.auditEvent.create({ data: {
      eventId: id,
      actorType: options.actorUserId ? 'ADMIN' : 'SYSTEM',
      actorUserId: options.actorUserId,
      action: reopening ? 'REGISTRATION_REOPENED' : 'EVENT_OPENED',
      entityType: 'Event', reason: options.reason ?? (reopening ? 'Registration reopened by Admin' : 'Registration opened by Admin'),
      entityId: id,
      beforeState: { status: event.status, registrationClosesAt: event.registrationClosesAt },
      afterState: { status: 'OPEN', registrationClosesAt: deadline },
      metadata: snapshot ? { policySnapshotId: snapshot.id } : undefined,
    } });
    return updated;
  });
}

export function closeEvent(
  prisma: PrismaClient,
  id: string,
  options: LifecycleOptions = {},
): Promise<EventResponse | null> {
  const now = options.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
    if (locked.length !== 1) return null;
    const event = await tx.event.findUniqueOrThrow({ where: { id }, omit: omitSecrets });
    if (event.status === 'CLOSED') return event;
    if (event.status !== 'OPEN') throw new EventLifecycleError();
    const updated = await tx.event.update({
      where: { id }, data: { status: 'CLOSED', registrationClosedAt: now }, omit: omitSecrets,
    });
    await tx.auditEvent.create({ data: {
      eventId: id, actorType: options.actorUserId ? 'ADMIN' : 'SYSTEM', actorUserId: options.actorUserId,
      action: 'REGISTRATION_CLOSED', entityType: 'Event', entityId: id, reason: options.reason ?? 'Registration closed by Admin',
      beforeState: { status: event.status, registrationClosedAt: event.registrationClosedAt },
      afterState: { status: 'CLOSED', registrationClosedAt: now },
    } });
    return updated;
  });
}

function assertDeadline(value: string): Date {
  try {
    return registrationDeadlineToDate(value);
  } catch {
    throw new EventValidationError(['registrationClosesAt']);
  }
}

function assertDeadlineBeforeStart(event: { eventDate: Date; startTime: string }, deadline: Date): void {
  if (deadline > localDateTimeToUtc(event.eventDate, event.startTime)) {
    throw new EventValidationError(['registrationClosesAt']);
  }
}

function assertAnnualCloneInput(input: unknown): ValidAnnualCloneInput {
  const parsed = annualCloneInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new EventValidationError(parsed.error.issues.map((issue) => String(issue.path[0])));
  }
  return parsed.data;
}

export async function cloneAnnualEvent(
  prisma: PrismaClient,
  id: string,
  input: AnnualCloneInput,
  audit: { actorUserId?: string; now?: Date; policyDocumentBaseUrl?: string } = {},
): Promise<EventResponse | null> {
  const fresh = assertAnnualCloneInput(input);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
    if (locked.length !== 1) return null;
    const source = await tx.event.findUniqueOrThrow({ where: { id }, include: { policyDocument: true, courtColors: true } });
    assertDeadlineBeforeStart({ eventDate: new Date(`${fresh.eventDate}T00:00:00.000Z`), startTime: source.startTime }, fresh.registrationClosesAt);
    const cloned = await tx.event.create({ data: {
      name: source.name, competitionYear: fresh.competitionYear, division: source.division, section: source.section,
      eventDate: new Date(`${fresh.eventDate}T00:00:00.000Z`), venue: source.venue, startTime: source.startTime, endTime: source.endTime,
      gameStartTime: source.gameStartTime, registrationClosesAt: fresh.registrationClosesAt, registrationFeeCents: source.registrationFeeCents,
      courts: source.courts, rank1Min: source.rank1Min, rank2Min: source.rank2Min, rank3Min: source.rank3Min,
      playMinutes: source.playMinutes, changeoverMinutes: source.changeoverMinutes, minAge: source.minAge, maxAge: source.maxAge,
      policyUrl: source.policyUrl, policyDocumentName: source.policyDocumentName, status: 'DRAFT',
    }, omit: omitSecrets });
    if (source.policyDocument) await tx.eventPolicyDocument.create({ data: {
      eventId: cloned.id, fileName: source.policyDocument.fileName, bytes: source.policyDocument.bytes,
    } });
    const completedClone = source.policyDocument && audit.policyDocumentBaseUrl
      ? await tx.event.update({
          where: { id: cloned.id },
          data: { policyUrl: `${audit.policyDocumentBaseUrl.replace(/\/$/, '')}/api/public/events/${cloned.id}/policy-document` },
          omit: omitSecrets,
        })
      : cloned;
    if (source.courtColors.length) await tx.eventCourtColor.createMany({ data: source.courtColors.map((color) => ({
      eventId: cloned.id, court: color.court, teamAColorId: color.teamAColorId, teamBColorId: color.teamBColorId,
    })) });
    await tx.auditEvent.create({ data: {
      eventId: cloned.id, actorType: 'ADMIN', actorUserId: audit.actorUserId, action: 'EVENT_CREATED',
      entityType: 'Event', entityId: cloned.id, reason: `Cloned from event ${source.id}`,
      afterState: { status: 'DRAFT', sourceEventId: source.id }, createdAt: audit.now,
    } });
    return completedClone;
  });
}

export type DeleteEventResult = 'deleted' | 'not_found' | 'has_registrations' | 'has_communications';

export async function deleteEvent(prisma: PrismaClient, id: string): Promise<DeleteEventResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${id} FOR UPDATE`);
    if (locked.length !== 1) return 'not_found';
    if (await tx.registration.count({ where: { eventId: id } }) > 0) return 'has_registrations';
    const [scheduled, deliveries, referencedByCampaign] = await Promise.all([
      tx.scheduledMessage.count({ where: { eventId: id } }),
      tx.emailLog.count({ where: { eventId: id } }),
      tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "SiteAssociationCommunication"
        WHERE "anchorEventId" = ${id} OR "eventIds" @> ${JSON.stringify([id])}::jsonb
        LIMIT 1
      `),
    ]);
    if (scheduled > 0 || deliveries > 0 || referencedByCampaign.length > 0) return 'has_communications';
    await tx.event.delete({ where: { id } });
    return 'deleted';
  });
}
