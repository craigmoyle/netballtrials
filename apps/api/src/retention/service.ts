import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type RegistrationStatus } from '@prisma/client';
import { melbourneDateKey } from '@netball-trials/types';

const BATCH_SIZE = 100;
const ANONYMIZED_DOB = new Date('1900-01-01T00:00:00.000Z');

export function retentionCutoff(eventDate: Date): Date {
  const year = eventDate.getUTCFullYear() + 1;
  const month = eventDate.getUTCMonth();
  const day = eventDate.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function isPastRetentionCutoff(eventDate: Date, now: Date): boolean {
  return melbourneDateKey(now) > retentionCutoff(eventDate).toISOString().slice(0, 10);
}

export async function anonymizeExpiredRegistrations(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const events = await prisma.event.findMany({ select: { id: true, eventDate: true } });
  const expiredEventIds = events
    .filter((event) => isPastRetentionCutoff(event.eventDate, now))
    .map((event) => event.id);
  if (expiredEventIds.length === 0) return 0;

  const registrations = await prisma.registration.findMany({
    where: { eventId: { in: expiredEventIds }, anonymizedAt: null },
    select: { id: true, eventId: true, status: true },
  });
  let anonymized = 0;

  for (let start = 0; start < registrations.length; start += BATCH_SIZE) {
    const batch = registrations.slice(start, start + BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const registration of batch) {
        const anonymizedRef = `anon_${randomUUID()}`;
        const claimed = await tx.registration.updateMany({
          where: { id: registration.id, anonymizedAt: null },
          data: {
            playerFirstName: '',
            playerLastName: '',
            playerNameNormalized: '',
            dateOfBirth: ANONYMIZED_DOB,
            parentName: '',
            parentEmail: '',
            parentMobile: '',
            memberAssociation: '',
            qrToken: null,
            checkoutSessionId: null,
            paymentIntentId: null,
            legacyPaymentRef: null,
            checkedInBy: null,
            bibNumber: null,
            ageFlagged: false,
            statusBeforeAnonymization: registration.status as RegistrationStatus,
            status: 'WITHDRAWN',
            anonymizedAt: now,
            anonymizedRef,
          },
        });
        if (claimed.count !== 1) continue;

        await tx.reviewItem.deleteMany({ where: { registrationId: registration.id } });
        await tx.roundPlanPlayer.updateMany({
          where: { registrationId: registration.id },
          data: { registrationId: anonymizedRef, playerName: 'Former participant', bibNumber: null },
        });
        await tx.roundSlot.updateMany({
          where: { registrationId: registration.id },
          data: { registrationId: anonymizedRef },
        });
        anonymized += 1;
      }
    }, { timeout: 60_000 });
  }

  // One set-based statement instead of a row-by-row update inside every
  // registration batch. batchId/idempotencyKey stay unique via the row id.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "EmailLog"
    SET "registrationId" = NULL,
        "batchId" = 'retained:' || "id",
        "idempotencyKey" = 'retained:' || "id",
        "to" = '',
        "subject" = '',
        "body" = '',
        "messagePayload" = NULL,
        "error" = NULL,
        "kind" = 'retention',
        "status" = 'ANONYMIZED',
        "updatedAt" = ${now}
    WHERE "eventId" = ANY(${expiredEventIds}::text[])
      AND "status" <> 'ANONYMIZED'
  `);
  await prisma.reviewItem.deleteMany({ where: { eventId: { in: expiredEventIds } } });
  await prisma.checkInSession.deleteMany({ where: { eventId: { in: expiredEventIds } } });
  return anonymized;
}

const RATE_LIMIT_BUCKET_TTL_MS = 24 * 60 * 60 * 1000;

export async function pruneRateLimitBuckets(prisma: PrismaClient, now: Date): Promise<number> {
  const result = await prisma.requestRateLimitBucket.deleteMany({
    where: { updatedAt: { lt: new Date(now.getTime() - RATE_LIMIT_BUCKET_TTL_MS) } },
  });
  return result.count;
}
