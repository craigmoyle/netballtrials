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
