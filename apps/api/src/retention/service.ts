import { randomUUID } from 'node:crypto';
import { Prisma, type EmailDeliveryState, type PrismaClient } from '@prisma/client';
import { melbourneDateKey } from '@netball-trials/types';
import { INTERRUPTED_SEND, lockMailEvent } from '../mail/lifecycle';

const ANONYMIZED_DOB = new Date('1900-01-01T00:00:00.000Z');

export const APPLICATION_RETENTION_YEARS = 4;

export function retentionCutoff(eventDate: Date): Date {
  const year = eventDate.getUTCFullYear() + APPLICATION_RETENTION_YEARS;
  const month = eventDate.getUTCMonth();
  const day = eventDate.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function isPastRetentionCutoff(eventDate: Date, now: Date): boolean {
  return melbourneDateKey(now) > retentionCutoff(eventDate).toISOString().slice(0, 10);
}

export type RetentionDeferral = {
  eventId: string;
  deliveries: Array<{ id: string; attempts: number; status: EmailDeliveryState }>;
};

export async function anonymizeExpiredRegistrations(
  prisma: PrismaClient,
  now: Date,
  onDeferred?: (deferral: RetentionDeferral) => void,
): Promise<number> {
  const events = await prisma.event.findMany({ select: { id: true, eventDate: true } });
  const expiredEventIds = events
    .filter((event) => isPastRetentionCutoff(event.eventDate, now))
    .map((event) => event.id);
  if (expiredEventIds.length === 0) return 0;

  let anonymized = 0;
  for (const eventId of expiredEventIds) {
    let deferred: RetentionDeferral | undefined;
    anonymized += await prisma.$transaction(async (tx) => {
      const event = await lockMailEvent(tx, eventId);
      if (!event || !isPastRetentionCutoff(event.eventDate, now)) return 0;
      const active = await tx.emailLog.findMany({
        where: { eventId, OR: [{ status: 'SENDING' }, { status: 'AMBIGUOUS', error: INTERRUPTED_SEND }] },
        select: { id: true, attempts: true, status: true },
        orderBy: { id: 'asc' },
      });
      // Interrupted claims need worker completion or operator reconciliation;
      // age alone cannot establish that an external send is no longer running.
      if (active.length > 0) {
        deferred = { eventId, deliveries: active };
        return 0;
      }

      const registrations = await tx.registration.findMany({
        where: { eventId, anonymizedAt: null },
        select: { id: true, status: true },
      });
      let count = 0;
      for (const registration of registrations) {
        const anonymizedRef = `anon_${randomUUID()}`;
        const claimed = await tx.registration.updateMany({
          where: { id: registration.id, anonymizedAt: null },
          data: {
            playerFirstName: '',
            playerLastName: '',
            playerNameNormalized: '',
            dateOfBirth: ANONYMIZED_DOB,
            parentAuthorityConfirmedAt: null,
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
            statusBeforeAnonymization: registration.status,
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
        count += 1;
      }

      // Scrub deliveries under the same lock as their preparation and claims.
      await tx.$executeRaw(Prisma.sql`
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
        WHERE "eventId" = ${eventId} AND "status" <> 'ANONYMIZED'
      `);
      await tx.reviewItem.deleteMany({ where: { eventId } });
      await tx.scheduledMessage.deleteMany({ where: { eventId } });
      await tx.checkInSession.deleteMany({ where: { eventId } });
      return count;
    }, { timeout: 60_000 });
    if (deferred) onDeferred?.(deferred);
  }
  return anonymized;
}

const RATE_LIMIT_BUCKET_TTL_MS = 24 * 60 * 60 * 1000;

export async function pruneRateLimitBuckets(prisma: PrismaClient, now: Date): Promise<number> {
  const result = await prisma.requestRateLimitBucket.deleteMany({
    where: { updatedAt: { lt: new Date(now.getTime() - RATE_LIMIT_BUCKET_TTL_MS) } },
  });
  return result.count;
}
