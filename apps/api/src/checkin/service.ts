import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { melbourneDateKey } from '@netball-trials/types';
import { generateToken, hashToken } from '../auth/tokens';
import { consumeRateLimit, reserveRateLimit, resetRateLimit } from '../security/rate-limit';
import { localDateTimeToUtc } from '../time/melbourne';
import { hashPin, isPinInput, verifyPin } from './pin';
import { appendRosterSnapshot } from '../roster/snapshots';
import { ageAtDecember31, isAgeInRange } from '../registrations/eligibility';

const PIN_WINDOW_MS = 10 * 60_000;
const PIN_CLIENT_LIMIT = 10;
const PIN_EVENT_FAILURE_LIMIT = 30;
const PIN_LOCK_PROBE_WINDOW_MS = 2_000;

export async function setCheckInPin(
  prisma: PrismaClient,
  eventId: string,
  pin: string | null,
  now: Date,
  actorUserId?: string,
): Promise<boolean> {
  const pinHash = pin ? await hashPin(pin) : null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.event.updateMany({
      where: { id: eventId },
      data: {
        checkInPinHash: pinHash,
        checkInPinUpdatedAt: now,
        checkInPinVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) return false;
    await tx.checkInSession.deleteMany({ where: { eventId, adminSessionId: null } });
    await tx.auditEvent.create({ data: {
      eventId, actorType: 'ADMIN', actorUserId, action: pin ? 'CHECK_IN_PIN_SET' : 'CHECK_IN_PIN_REMOVED',
      entityType: 'Event', entityId: eventId, reason: pin ? 'Event PIN rotated' : 'Event PIN removed',
      afterState: { pinConfigured: Boolean(pin) }, createdAt: now,
    } });
    return true;
  });
}

export async function closeCheckIn(
  prisma: PrismaClient,
  eventId: string,
  now: Date,
  actorUserId?: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    if (locked.length === 0) return false;
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { checkInClosedAt: true, eventDate: true } });
    if (!isEventDate(event.eventDate, now)) return false;
    if (event.checkInClosedAt) return true;
    await tx.event.update({
      where: { id: eventId },
      data: { checkInClosedAt: now, checkInPinVersion: { increment: 1 } },
    });
    await appendRosterSnapshot(tx, eventId);
    await tx.auditEvent.create({
      data: {
        eventId,
        actorType: 'ADMIN',
        actorUserId,
        action: 'CHECK_IN_CLOSED', reason: 'Check-in closed by Admin',
        entityType: 'Event',
        entityId: eventId,
        beforeState: { checkInClosedAt: null },
        afterState: { checkInClosedAt: now.toISOString() },
        createdAt: now,
      },
    });
    await tx.checkInSession.deleteMany({ where: { eventId } });
    return true;
  });
}

export async function reopenCheckIn(
  prisma: PrismaClient,
  eventId: string,
  now: Date,
  actorUserId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    if (locked.length === 0) return false;
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { checkInClosedAt: true, eventDate: true } });
    if (!isEventDate(event.eventDate, now)) return false;
    if (!event.checkInClosedAt) return true;
    await tx.event.update({ where: { id: eventId }, data: { checkInClosedAt: null, checkInPinVersion: { increment: 1 } } });
    await tx.auditEvent.create({
      data: {
        eventId,
        actorType: 'ADMIN',
        actorUserId,
        action: 'CHECK_IN_REOPENED', reason: 'Check-in explicitly reopened by Admin',
        entityType: 'Event',
        entityId: eventId,
        beforeState: { checkInClosedAt: event.checkInClosedAt.toISOString() },
        afterState: { checkInClosedAt: null },
        createdAt: now,
      },
    });
    return true;
  });
}

export class PinInvalidError extends Error {}
export class PinLockedError extends Error {}
export class CheckInClosedError extends Error {}
export class CheckInUnavailableError extends Error {}
export class CheckInSessionRevokedError extends Error {}

export function checkInSessionExpiry(eventDate: Date): Date {
  const midnightAfterExpiryDay = new Date(eventDate);
  midnightAfterExpiryDay.setUTCDate(midnightAfterExpiryDay.getUTCDate() + 2);
  return new Date(localDateTimeToUtc(midnightAfterExpiryDay, '00:00').getTime() - 1);
}

function isEventDate(eventDate: Date, now: Date): boolean {
  return melbourneDateKey(now) === eventDate.toISOString().slice(0, 10);
}

function volunteerSessionExpiry(eventDate: Date): Date {
  const midnightAfterEvent = new Date(eventDate);
  midnightAfterEvent.setUTCDate(midnightAfterEvent.getUTCDate() + 1);
  return new Date(localDateTimeToUtc(midnightAfterEvent, '00:00').getTime() - 1);
}

type SessionWithEvent = Prisma.CheckInSessionGetPayload<{ include: { event: true; adminSession: true } }>;

function isActiveSession(session: SessionWithEvent | null, now: Date): session is SessionWithEvent {
  if (!session || session.expiresAt.getTime() <= now.getTime() || session.event.checkInClosedAt) return false;
  if (!isEventDate(session.event.eventDate, now)) return false;
  if (now.getTime() > checkInSessionExpiry(session.event.eventDate).getTime()) return false;
  if (session.expiresAt.getTime() > checkInSessionExpiry(session.event.eventDate).getTime()) return false;

  if (session.adminSessionId) {
    return Boolean(session.adminSession && session.adminSession.expiresAt.getTime() > now.getTime());
  }

  return Boolean(session.pinVersion === session.event.checkInPinVersion && session.event.checkInPinHash);
}

async function findActiveSession(
  prisma: PrismaClient | Prisma.TransactionClient,
  token: string | undefined,
  now: Date,
): Promise<SessionWithEvent | null> {
  if (!token) return null;
  const session = await prisma.checkInSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { event: true, adminSession: true },
  });
  return isActiveSession(session, now) ? session : null;
}

export async function openCheckInSession(
  deps: { prisma: PrismaClient },
  input: { eventId: string; pin: string; clientKey: string },
  now: Date,
): Promise<{ token: string; expiresAt: Date; eventName: string }> {
  const event = await deps.prisma.event.findUnique({ where: { id: input.eventId } });
  if (!event || !event.checkInPinHash || !isEventDate(event.eventDate, now)) {
    throw new CheckInUnavailableError();
  }
  if (event.checkInClosedAt) throw new CheckInClosedError();

  const key = createHash('sha256').update(`checkin:${input.eventId}:${input.clientKey}`).digest('hex');
  if (!(await consumeRateLimit(deps.prisma, key, now, PIN_CLIENT_LIMIT, PIN_WINDOW_MS))) {
    throw new PinLockedError();
  }
  // Reject malformed input before it reaches scrypt.
  if (!isPinInput(input.pin)) throw new PinInvalidError();

  // Event-wide cap on wrong PINs so rotating client addresses cannot brute-force the PIN.
  // Reserve before scrypt so concurrent guesses cannot bypass the cap; denied attempts
  // consume no capacity. Keyed by PIN version so rotating the PIN clears a lockout.
  const failureKey = `checkin-fail:${input.eventId}:${event.checkInPinVersion}`;
  const windowStartedAt = await reserveRateLimit(deps.prisma, failureKey, now, PIN_EVENT_FAILURE_LIMIT, PIN_WINDOW_MS);
  const probeKey = `checkin-probe:${input.eventId}:${event.checkInPinVersion}`;
  if (!windowStartedAt && !await reserveRateLimit(deps.prisma, probeKey, now, 1, PIN_LOCK_PROBE_WINDOW_MS)) {
    throw new PinLockedError();
  }
  const valid = await verifyPin(input.pin, event.checkInPinHash);
  if (!valid) {
    throw windowStartedAt ? new PinInvalidError() : new PinLockedError();
  }
  if (windowStartedAt) {
    // A slow verification must not refund a failure counted in a newer window.
    await deps.prisma.requestRateLimitBucket.updateMany({
      where: { key: failureKey, windowStartedAt, hits: { gt: 0 } },
      data: { hits: { decrement: 1 } },
    });
  } else {
    await Promise.all([resetRateLimit(deps.prisma, failureKey), resetRateLimit(deps.prisma, probeKey)]);
  }
  await resetRateLimit(deps.prisma, key);

  const token = generateToken();
  const expiresAt = volunteerSessionExpiry(event.eventDate);
  const session = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.event.findFirst({
      where: {
        id: event.id,
        checkInPinHash: event.checkInPinHash,
        checkInPinVersion: event.checkInPinVersion,
        checkInClosedAt: null,
      },
    });
    if (!current) return null;
    if (!isEventDate(current.eventDate, now)) throw new CheckInUnavailableError();
    return tx.checkInSession.create({
      data: {
        eventId: event.id,
        tokenHash: hashToken(token),
        pinVersion: event.checkInPinVersion,
        expiresAt,
      },
    });
  });
  if (!session) throw new CheckInClosedError();
  return { token, expiresAt, eventName: event.name };
}

export async function openAdminCheckInSession(
  prisma: PrismaClient,
  eventId: string,
  adminSessionId: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date; eventName: string }> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || !isEventDate(event.eventDate, now) || now.getTime() > checkInSessionExpiry(event.eventDate).getTime()) throw new CheckInUnavailableError();
  if (event.checkInClosedAt) throw new CheckInClosedError();
  const adminSession = await prisma.session.findFirst({ where: { id: adminSessionId, expiresAt: { gt: now } } });
  if (!adminSession) throw new CheckInSessionRevokedError();

  const token = generateToken();
  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    const currentEvent = await tx.event.findFirst({ where: { id: eventId, checkInClosedAt: null } });
    const currentAdmin = await tx.session.findFirst({ where: { id: adminSessionId, expiresAt: { gt: now } } });
    if (!currentEvent || !currentAdmin || !isEventDate(currentEvent.eventDate, now) || now.getTime() > checkInSessionExpiry(currentEvent.eventDate).getTime()) return null;
    return tx.checkInSession.create({
      data: {
        eventId,
        tokenHash: hashToken(token),
        pinVersion: currentEvent.checkInPinVersion,
        adminSessionId: currentAdmin.id,
        expiresAt: new Date(Math.min(currentAdmin.expiresAt.getTime(), checkInSessionExpiry(currentEvent.eventDate).getTime())),
      },
    });
  });
  if (!session) throw new CheckInSessionRevokedError();
  return { token, expiresAt: session.expiresAt, eventName: event.name };
}

export type CheckInSummary = {
  eventId: string;
  eventName: string;
  registered: number;
  checkedIn: number;
  closed: boolean;
};

export async function getCheckInSummary(
  prisma: PrismaClient,
  token: string,
  now: Date,
): Promise<CheckInSummary | null> {
  const session = await findActiveSession(prisma, token, now);
  if (!session) return null;

  const [registered, checkedIn] = await Promise.all([
    prisma.registration.count({ where: { eventId: session.event.id, status: 'PAID' } }),
    prisma.registration.count({
      where: { eventId: session.event.id, status: 'PAID', checkedInAt: { not: null } },
    }),
  ]);

  return {
    eventId: session.event.id,
    eventName: session.event.name,
    registered,
    checkedIn,
    closed: false,
  };
}

export async function resolveCheckInEvent(
  prisma: PrismaClient,
  token: string | undefined,
  now: Date,
): Promise<string | null> {
  const session = await findActiveSession(prisma, token, now);
  return session?.event.id ?? null;
}

export type CheckInResult = {
  result: 'checked_in' | 'already' | 'refused';
  reason?: 'not_paid' | 'ineligible' | 'unknown';
  registrationId?: string;
  playerName?: string;
  bibNumber?: number;
  referToCommittee: boolean;
};

type RegistrationRow = {
  id: string;
  eventId: string;
  status: string;
  ageFlagged: boolean;
  checkedInAt: Date | null;
  bibNumber: number | null;
  playerFirstName: string;
  playerLastName: string;
};

class CheckInClaimLost extends Error {}

export class LateArrivalError extends Error {
  constructor(
    readonly code: 'not_found' | 'unavailable' | 'payment_unverified' | 'ineligible' | 'removed',
    readonly competitionYear?: number,
    readonly minAge?: number,
    readonly maxAge?: number,
  ) {
    super(code);
    this.name = 'LateArrivalError';
  }
}

export async function completeLateArrival(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  actorUserId: string,
  now: Date,
): Promise<CheckInResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || event.status === 'DRAFT' || !isEventDate(event.eventDate, now)) throw new LateArrivalError('unavailable');
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Registration" WHERE "id" = ${registrationId} AND "eventId" = ${eventId} FOR UPDATE`);
    const registration = await tx.registration.findFirst({ where: { id: registrationId, eventId }, include: { policySnapshot: true } });
    if (!registration) throw new LateArrivalError('not_found');
    if (!['PAID'].includes(registration.status)) throw new LateArrivalError('payment_unverified');
    if (registration.removedAt || registration.status !== 'PAID') throw new LateArrivalError('removed');
    const verifiedPayment = registration.parentEmailVerifiedAt && registration.paidAt &&
      (registration.amountCents === 0 || registration.paymentIntentId);
    if (!verifiedPayment) throw new LateArrivalError('payment_unverified');
    const competitionYear = registration.policySnapshot?.competitionYear ?? event.competitionYear;
    const minAge = registration.policySnapshot?.minAge ?? event.minAge;
    const maxAge = registration.policySnapshot?.maxAge ?? event.maxAge;
    if (registration.ageFlagged || !isAgeInRange(ageAtDecember31(registration.dateOfBirth, competitionYear), minAge, maxAge)) {
      throw new LateArrivalError('ineligible', competitionYear, minAge, maxAge);
    }
    if (registration.checkedInAt) {
      return {
        result: 'already', registrationId, playerName: displayName(registration),
        bibNumber: registration.bibNumber ?? undefined, referToCommittee: false,
      };
    }

    let bibNumber = registration.bibNumber;
    if (bibNumber === null) {
      const advanced = await tx.event.update({ where: { id: eventId }, data: { nextBibNumber: { increment: 1 } }, select: { nextBibNumber: true } });
      bibNumber = advanced.nextBibNumber - 1;
    }
    const beforeState = { status: registration.status, checkedInAt: null, bibNumber: registration.bibNumber };
    await tx.registration.update({
      where: { id: registration.id },
      data: { checkedInAt: now, checkedInBy: 'Chisholm Admin', bibNumber },
    });
    const hasInitialSnapshot = await tx.rosterSnapshot.count({ where: { eventId } });
    if (hasInitialSnapshot > 0) await appendRosterSnapshot(tx, eventId);
    await tx.auditEvent.create({
      data: {
        eventId,
        registrationId,
        actorType: 'ADMIN',
        actorUserId,
        action: 'LATE_ARRIVAL_COMPLETED',
        entityType: 'Registration',
        entityId: registrationId,
        reason: 'Paid late arrival after check-in closure',
        beforeState,
        afterState: { status: 'PAID', checkedInAt: now.toISOString(), bibNumber },
        createdAt: now,
      },
    });
    return {
      result: 'checked_in', registrationId, playerName: displayName(registration), bibNumber,
      referToCommittee: false,
    };
  });
}

function displayName(registration: RegistrationRow): string {
  return `${registration.playerFirstName} ${registration.playerLastName}`.trim();
}

async function freshResult(prisma: PrismaClient, registrationId: string): Promise<CheckInResult> {
  const fresh = await prisma.registration.findUnique({ where: { id: registrationId } }) as RegistrationRow | null;
  if (!fresh) return { result: 'refused', reason: 'unknown', referToCommittee: false };
  if (fresh.status !== 'PAID') return { result: 'refused', reason: 'not_paid', referToCommittee: false };
  if (fresh.ageFlagged) return { result: 'refused', reason: 'ineligible', referToCommittee: true };
  return {
    result: 'already',
    registrationId: fresh.id,
    playerName: displayName(fresh),
    bibNumber: fresh.bibNumber ?? undefined,
    referToCommittee: false,
  };
}

async function checkInRegistration(
  prisma: PrismaClient,
  registration: RegistrationRow,
  label: string,
  now: Date,
  sessionToken: string,
): Promise<CheckInResult | null> {
  if (registration.status !== 'PAID') {
    return { result: 'refused', reason: 'not_paid', referToCommittee: false };
  }
  if (registration.ageFlagged) {
    return { result: 'refused', reason: 'ineligible', referToCommittee: true };
  }
  if (registration.checkedInAt) {
    return {
      result: 'already',
      registrationId: registration.id,
      playerName: displayName(registration),
      bibNumber: registration.bibNumber ?? undefined,
      referToCommittee: false,
    };
  }

  try {
    const bibNumber = await prisma.$transaction(async (tx) => {
      const session = await findActiveSession(tx, sessionToken, now);
      if (!session || session.event.id !== registration.eventId) throw new CheckInSessionRevokedError();

      // Lock the event row and re-check closure and PIN version before claiming the registration.
      const locked = await tx.event.updateMany({
        where: {
          id: registration.eventId,
          checkInClosedAt: null,
          ...(session.adminSessionId ? {} : {
            checkInPinVersion: session.pinVersion,
            checkInPinHash: { not: null },
          }),
        },
        data: { nextBibNumber: { increment: 0 } },
      });
      if (locked.count !== 1) throw new CheckInSessionRevokedError();

      // A registration keeps its number across undo/redo; only new arrivals advance the counter.
      const current = await tx.registration.findUnique({ where: { id: registration.id }, select: { bibNumber: true, status: true, ageFlagged: true } });
      if (!current || current.status !== 'PAID' || current.ageFlagged) throw new CheckInClaimLost();
      let bibNumber = current.bibNumber;
      if (bibNumber === null) {
        const event = await tx.event.update({
          where: { id: registration.eventId },
          data: { nextBibNumber: { increment: 1 } },
          select: { nextBibNumber: true },
        });
        bibNumber = event.nextBibNumber - 1;
      }

      const claimed = await tx.registration.updateMany({
        where: {
          id: registration.id,
          eventId: registration.eventId,
          status: 'PAID',
          ageFlagged: false,
          checkedInAt: null,
        },
        data: {
          checkedInAt: now,
          checkedInBy: session.adminSessionId ? 'Chisholm Admin' : label,
          bibNumber,
        },
      });
      if (claimed.count !== 1) throw new CheckInClaimLost();
      await tx.auditEvent.create({ data: {
        eventId: registration.eventId, registrationId: registration.id,
        actorType: session.adminSessionId ? 'ADMIN' : 'VOLUNTEER', actorUserId: session.adminSession?.userId,
        action: 'PLAYER_CHECKED_IN', entityType: 'Registration', entityId: registration.id,
        reason: session.adminSessionId ? 'Admin check-in recorded' : `Volunteer check-in by ${label}`,
        beforeState: { checkedInAt: null }, afterState: { checkedInAt: now.toISOString(), bibNumber }, createdAt: now,
      } });
      return bibNumber;
    });

    return {
      result: 'checked_in',
      registrationId: registration.id,
      playerName: displayName(registration),
      bibNumber,
      referToCommittee: false,
    };
  } catch (error) {
    if (error instanceof CheckInSessionRevokedError) return null;
    if (!(error instanceof CheckInClaimLost)) throw error;
    return freshResult(prisma, registration.id);
  }
}

export async function checkInByToken(
  prisma: PrismaClient,
  eventId: string,
  token: string,
  label: string,
  now: Date,
  sessionToken: string,
): Promise<CheckInResult | null> {
  const registration = await prisma.registration.findFirst({ where: { eventId, qrToken: token } }) as RegistrationRow | null;
  if (!registration) return { result: 'refused', reason: 'unknown', referToCommittee: false };
  return checkInRegistration(prisma, registration, label, now, sessionToken);
}

export async function manualCheckIn(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  label: string,
  now: Date,
  sessionToken: string,
): Promise<CheckInResult | null> {
  const registration = await prisma.registration.findFirst({ where: { id: registrationId, eventId } }) as RegistrationRow | null;
  if (!registration) return { result: 'refused', reason: 'unknown', referToCommittee: false };
  return checkInRegistration(prisma, registration, label, now, sessionToken);
}

export async function lookupRegistrations(
  prisma: PrismaClient,
  eventId: string,
  query: string,
): Promise<{ id: string; playerName: string; bibNumber: number | null; checkedIn: boolean }[]> {
  const rows = (await prisma.registration.findMany({
    where: {
      eventId,
      status: 'PAID',
      ageFlagged: false,
      playerNameNormalized: { contains: query.trim().toLowerCase() },
    },
    orderBy: { playerNameNormalized: 'asc' },
    take: 20,
  })) as RegistrationRow[];

  return rows.map((row) => ({
    id: row.id,
    playerName: displayName(row),
    // An undone check-in keeps its reserved number, but only show numbers for players who are here.
    bibNumber: row.checkedInAt ? row.bibNumber : null,
    checkedIn: row.checkedInAt !== null,
  }));
}

export async function undoCheckIn(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  sessionToken: string,
  now: Date,
): Promise<boolean | null> {
  return prisma.$transaction(async (tx) => {
    const session = await findActiveSession(tx, sessionToken, now);
    if (!session || session.event.id !== eventId) return null;
    const event = await tx.event.updateMany({
      where: {
        id: eventId,
        checkInClosedAt: null,
        ...(session.adminSessionId ? {} : {
          checkInPinVersion: session.pinVersion,
          checkInPinHash: { not: null },
        }),
      },
      data: { nextBibNumber: { increment: 0 } },
    });
    if (event.count !== 1) return null;
    const previous = await tx.registration.findFirst({ where: { id: registrationId, eventId }, select: { checkedInAt: true, bibNumber: true } });
    const result = await tx.registration.updateMany({
      where: { id: registrationId, eventId, status: 'PAID', checkedInAt: { not: null } },
      // Keep bibNumber so a redo reuses the same number instead of issuing a new one.
      data: { checkedInAt: null, checkedInBy: null },
    });
    if (result.count === 1 && previous) await tx.auditEvent.create({ data: {
      eventId, registrationId, actorType: session.adminSessionId ? 'ADMIN' : 'VOLUNTEER', actorUserId: session.adminSession?.userId,
      action: 'PLAYER_CHECK_IN_UNDONE', entityType: 'Registration', entityId: registrationId,
      reason: 'Check-in undone by authorised operator', beforeState: { checkedInAt: previous.checkedInAt?.toISOString() ?? null, bibNumber: previous.bibNumber },
      afterState: { checkedInAt: null, bibNumber: previous.bibNumber }, createdAt: now,
    } });
    return result.count === 1;
  });
}
