import type { PrismaClient } from '@prisma/client';
import { hashPin } from './pin';

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
