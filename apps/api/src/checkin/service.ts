import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { generateToken, hashToken } from '../auth/tokens';
import { ensureReviewItems } from '../review/service';
import { consumeRateLimit, resetRateLimit } from '../security/rate-limit';
import { localDateTimeToUtc } from '../time/melbourne';
import { hashPin, isPinInput, verifyPin } from './pin';

const PIN_WINDOW_MS = 10 * 60_000;
const PIN_CLIENT_LIMIT = 10;
const PIN_EVENT_FAILURE_LIMIT = 30;

export async function setCheckInPin(
  prisma: PrismaClient,
  eventId: string,
  pin: string | null,
  now: Date,
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
    return true;
  });
}

export async function closeCheckIn(
  prisma: PrismaClient,
  eventId: string,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.event.updateMany({
      where: { id: eventId },
      data: { checkInClosedAt: now, checkInPinVersion: { increment: 1 } },
    });
    if (updated.count === 0) return false;
    await tx.checkInSession.deleteMany({ where: { eventId } });
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

type SessionWithEvent = Prisma.CheckInSessionGetPayload<{ include: { event: true; adminSession: true } }>;

function isActiveSession(session: SessionWithEvent | null, now: Date): session is SessionWithEvent {
  if (!session || session.expiresAt.getTime() <= now.getTime() || session.event.checkInClosedAt) return false;
  if (now.getTime() > checkInSessionExpiry(session.event.eventDate).getTime()) return false;
  if (session.expiresAt.getTime() > checkInSessionExpiry(session.event.eventDate).getTime()) return false;

  return session.adminSessionId
    ? Boolean(session.adminSession && session.adminSession.expiresAt.getTime() > now.getTime())
    : Boolean(session.pinVersion === session.event.checkInPinVersion && session.event.checkInPinHash);
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
  if (!event || !event.checkInPinHash || now.getTime() > checkInSessionExpiry(event.eventDate).getTime()) {
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
  // Record the attempt before the slow scrypt check so concurrent guesses cannot all pass
  // a stale read, then give it back for a correct PIN. Keyed by PIN version so rotating
  // the PIN clears a lockout.
  const failureKey = `checkin-fail:${input.eventId}:${event.checkInPinVersion}`;
  if (!(await consumeRateLimit(deps.prisma, failureKey, now, PIN_EVENT_FAILURE_LIMIT, PIN_WINDOW_MS))) {
    throw new PinLockedError();
  }
  if (!(await verifyPin(input.pin, event.checkInPinHash))) {
    throw new PinInvalidError();
  }
  await deps.prisma.requestRateLimitBucket.updateMany({
    where: { key: failureKey, hits: { gt: 0 } },
    data: { hits: { decrement: 1 } },
  });
  await resetRateLimit(deps.prisma, key);

  const token = generateToken();
  const expiresAt = checkInSessionExpiry(event.eventDate);
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
  if (!event || now.getTime() > checkInSessionExpiry(event.eventDate).getTime()) throw new CheckInUnavailableError();
  if (event.checkInClosedAt) throw new CheckInClosedError();
  const adminSession = await prisma.session.findFirst({ where: { id: adminSessionId, expiresAt: { gt: now } } });
  if (!adminSession) throw new CheckInSessionRevokedError();

  const token = generateToken();
  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`);
    const currentEvent = await tx.event.findFirst({ where: { id: eventId, checkInClosedAt: null } });
    const currentAdmin = await tx.session.findFirst({ where: { id: adminSessionId, expiresAt: { gt: now } } });
    if (!currentEvent || !currentAdmin || now.getTime() > checkInSessionExpiry(currentEvent.eventDate).getTime()) return null;
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
  reason?: 'not_paid' | 'unknown';
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

function displayName(registration: RegistrationRow): string {
  return `${registration.playerFirstName} ${registration.playerLastName}`.trim();
}

async function hasOpenReview(prisma: PrismaClient, registration: RegistrationRow): Promise<boolean> {
  if (!registration.ageFlagged || registration.status !== 'PAID') return false;
  await ensureReviewItems(prisma, registration.eventId);
  return Boolean(await prisma.reviewItem.findFirst({
    where: { registrationId: registration.id, reason: 'age_out_of_range', resolvedAt: null },
    select: { id: true },
  }));
}

async function freshResult(prisma: PrismaClient, registrationId: string): Promise<CheckInResult> {
  const fresh = await prisma.registration.findUnique({ where: { id: registrationId } }) as RegistrationRow | null;
  if (!fresh) return { result: 'refused', reason: 'unknown', referToCommittee: false };
  if (fresh.status !== 'PAID') return { result: 'refused', reason: 'not_paid', referToCommittee: false };
  return {
    result: 'already',
    registrationId: fresh.id,
    playerName: displayName(fresh),
    bibNumber: fresh.bibNumber ?? undefined,
    referToCommittee: await hasOpenReview(prisma, fresh),
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
  const referToCommittee = await hasOpenReview(prisma, registration);
  if (registration.checkedInAt) {
    return {
      result: 'already',
      registrationId: registration.id,
      playerName: displayName(registration),
      bibNumber: registration.bibNumber ?? undefined,
      referToCommittee,
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
      const current = await tx.registration.findUnique({ where: { id: registration.id }, select: { bibNumber: true } });
      let bibNumber = current?.bibNumber ?? null;
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
          checkedInAt: null,
        },
        data: {
          checkedInAt: now,
          checkedInBy: session.adminSessionId ? 'Chisholm Admin' : label,
          bibNumber,
        },
      });
      if (claimed.count !== 1) throw new CheckInClaimLost();
      return bibNumber;
    });

    return {
      result: 'checked_in',
      registrationId: registration.id,
      playerName: displayName(registration),
      bibNumber,
      referToCommittee,
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
    const result = await tx.registration.updateMany({
      where: { id: registrationId, eventId, status: 'PAID', checkedInAt: { not: null } },
      // Keep bibNumber so a redo reuses the same number instead of issuing a new one.
      data: { checkedInAt: null, checkedInBy: null },
    });
    return result.count === 1;
  });
}
