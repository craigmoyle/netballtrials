import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type RegistrationStatus } from '@prisma/client';

const BATCH_SIZE = 100;
const ANONYMIZED_DOB = new Date('1900-01-01T00:00:00.000Z');

export function retentionCutoff(eventDate: Date): Date {
  const year = eventDate.getUTCFullYear() + 1;
  const month = eventDate.getUTCMonth();
  const day = eventDate.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function melbourneDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
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

  const batches = registrations.length
    ? Array.from({ length: Math.ceil(registrations.length / BATCH_SIZE) }, (_, index) => registrations.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE))
    : [[]];
  for (const batch of batches) {
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
      const emailLogs = await tx.emailLog.findMany({
        where: { eventId: { in: expiredEventIds }, status: { not: 'ANONYMIZED' } },
        select: { id: true },
      });
      for (const log of emailLogs) {
        await tx.emailLog.update({
          where: { id: log.id },
          data: {
            registrationId: null,
            batchId: `retained:${log.id}`,
            idempotencyKey: `retained:${log.id}`,
            to: '',
            subject: '',
            body: '',
            messagePayload: Prisma.DbNull,
            error: null,
            kind: 'retention',
            status: 'ANONYMIZED',
          },
        });
      }
      await tx.reviewItem.deleteMany({ where: { eventId: { in: expiredEventIds } } });
      await tx.checkInSession.deleteMany({ where: { eventId: { in: expiredEventIds } } });
    });
  }
  return anonymized;
}
