import type { PrismaClient } from '@prisma/client';
import { generateToken, hashToken } from '../auth/tokens';
import { hashPin, verifyPin } from './pin';
import type { PinLimiter } from './limiter';

export async function setCheckInPin(
  prisma: PrismaClient,
  eventId: string,
  pin: string | null,
  now: Date,
): Promise<boolean> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return false;
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      checkInPinHash: pin ? hashPin(pin) : null,
      checkInPinUpdatedAt: now,
    },
  });

  return true;
}

export async function closeCheckIn(
  prisma: PrismaClient,
  eventId: string,
  now: Date,
): Promise<boolean> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return false;
  }
  await prisma.event.update({ where: { id: eventId }, data: { checkInClosedAt: now } });
  return true;
}

export class PinInvalidError extends Error {}
export class PinLockedError extends Error {}
export class CheckInClosedError extends Error {}
export class CheckInUnavailableError extends Error {}

export function checkInSessionExpiry(eventDate: Date): Date {
  const end = new Date(eventDate);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export async function openCheckInSession(
  deps: { prisma: PrismaClient },
  input: { eventId: string; pin: string; clientKey: string },
  now: Date,
  limiter: PinLimiter,
): Promise<{ token: string; expiresAt: Date; eventName: string }> {
  const event = await deps.prisma.event.findUnique({ where: { id: input.eventId } });
  if (!event || !event.checkInPinHash) {
    throw new CheckInUnavailableError();
  }
  if (now.getTime() > checkInSessionExpiry(event.eventDate).getTime()) {
    throw new CheckInUnavailableError();
  }
  if (event.checkInClosedAt) {
    throw new CheckInClosedError();
  }

  const key = `${input.clientKey}:${input.eventId}`;
  if (!limiter.allow(key, now)) {
    throw new PinLockedError();
  }

  if (!verifyPin(input.pin, event.checkInPinHash)) {
    limiter.fail(key, now);
    throw new PinInvalidError();
  }
  limiter.reset(key);

  const token = generateToken();
  const expiresAt = checkInSessionExpiry(event.eventDate);
  await deps.prisma.checkInSession.create({
    data: { eventId: event.id, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt, eventName: event.name };
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
  const session = await prisma.checkInSession.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session || session.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event) {
    return null;
  }

  const [registered, checkedIn] = await Promise.all([
    prisma.registration.count({ where: { eventId: event.id, status: 'PAID' } }),
    prisma.registration.count({
      where: { eventId: event.id, status: 'PAID', checkedInAt: { not: null } },
    }),
  ]);

  return {
    eventId: event.id,
    eventName: event.name,
    registered,
    checkedIn,
    closed: event.checkInClosedAt !== null,
  };
}

export async function resolveCheckInEvent(
  prisma: PrismaClient,
  token: string | undefined,
  now: Date,
): Promise<string | null> {
  if (!token) {
    return null;
  }
  const session = await prisma.checkInSession.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session || session.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  return session.eventId;
}

export type CheckInResult = {
  result: 'checked_in' | 'already' | 'refused';
  reason?: 'not_paid' | 'unknown';
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

function displayName(registration: RegistrationRow): string {
  return `${registration.playerFirstName} ${registration.playerLastName}`.trim();
}

async function checkInRegistration(
  prisma: PrismaClient,
  registration: RegistrationRow,
  label: string,
  now: Date,
): Promise<CheckInResult> {
  if (registration.status !== 'PAID') {
    return { result: 'refused', reason: 'not_paid', referToCommittee: registration.ageFlagged };
  }

  if (registration.checkedInAt) {
    return {
      result: 'already',
      playerName: displayName(registration),
      bibNumber: registration.bibNumber ?? undefined,
      referToCommittee: registration.ageFlagged,
    };
  }

  const bibNumber = await prisma.$transaction(async (tx) => {
    const updatedEvent = await tx.event.update({
      where: { id: registration.eventId },
      data: { nextBibNumber: { increment: 1 } },
    });
    const candidate = updatedEvent.nextBibNumber - 1;

    const claimed = await tx.registration.updateMany({
      where: { id: registration.id, checkedInAt: null },
      data: { checkedInAt: now, checkedInBy: label, bibNumber: candidate },
    });

    return claimed.count === 1 ? candidate : null;
  });

  if (bibNumber === null) {
    const fresh = (await prisma.registration.findUnique({
      where: { id: registration.id },
    })) as RegistrationRow | null;
    return {
      result: 'already',
      playerName: fresh ? displayName(fresh) : undefined,
      bibNumber: fresh?.bibNumber ?? undefined,
      referToCommittee: fresh?.ageFlagged ?? false,
    };
  }

  return {
    result: 'checked_in',
    playerName: displayName(registration),
    bibNumber,
    referToCommittee: registration.ageFlagged,
  };
}

export async function checkInByToken(
  prisma: PrismaClient,
  eventId: string,
  token: string,
  label: string,
  now: Date,
): Promise<CheckInResult> {
  const registration = (await prisma.registration.findFirst({
    where: { eventId, qrToken: token },
  })) as RegistrationRow | null;

  if (!registration) {
    return { result: 'refused', reason: 'unknown', referToCommittee: false };
  }
  return checkInRegistration(prisma, registration, label, now);
}

export async function manualCheckIn(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
  label: string,
  now: Date,
): Promise<CheckInResult> {
  const registration = (await prisma.registration.findFirst({
    where: { id: registrationId, eventId },
  })) as RegistrationRow | null;

  if (!registration) {
    return { result: 'refused', reason: 'unknown', referToCommittee: false };
  }
  return checkInRegistration(prisma, registration, label, now);
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
    bibNumber: row.bibNumber,
    checkedIn: row.checkedInAt !== null,
  }));
}

export async function undoCheckIn(
  prisma: PrismaClient,
  eventId: string,
  registrationId: string,
): Promise<boolean> {
  const result = await prisma.registration.updateMany({
    where: { id: registrationId, eventId, checkedInAt: { not: null } },
    data: { checkedInAt: null, checkedInBy: null, bibNumber: null },
  });
  return result.count === 1;
}
