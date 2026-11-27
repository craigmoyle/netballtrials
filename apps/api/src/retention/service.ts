import { randomUUID } from 'node:crypto';
import { Prisma, type EmailDeliveryState, type PrismaClient } from '@prisma/client';
import { melbourneDateKey } from '@netball-trials/types';
import { INTERRUPTED_SEND, lockMailEvent } from '../mail/lifecycle';
import { ORPHANED_PAYMENT_REVIEW_REASON } from '../review/service';

const ANONYMIZED_DOB = new Date('1900-01-01T00:00:00.000Z');

export const APPLICATION_RETENTION_YEARS = 4;
export const INCOMPLETE_REGISTRATION_RETENTION_DAYS = 30;

export function retentionCutoff(eventDate: Date): Date {
  const year = eventDate.getUTCFullYear() + APPLICATION_RETENTION_YEARS;
  const month = eventDate.getUTCMonth();
  const day = eventDate.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function earliestRetainedEventDate(now: Date): Date {
  const [year, month, day] = melbourneDateKey(now).split('-').map(Number);
  const cutoffYear = year - APPLICATION_RETENTION_YEARS;
  const lastDay = new Date(Date.UTC(cutoffYear, month, 0)).getUTCDate();
  return new Date(Date.UTC(cutoffYear, month - 1, Math.min(day, lastDay)));
}

export function isPastRetentionCutoff(eventDate: Date, now: Date): boolean {
  return melbourneDateKey(now) > retentionCutoff(eventDate).toISOString().slice(0, 10);
}

export type RetentionDeferral = {
  eventId: string;
  deliveries: Array<{ id: string; attempts: number; status: EmailDeliveryState }>;
};

type AnonymizedReference = { registrationId: string; anonymizedRef: string };

function deliveryTouchesRegistrations(
  delivery: { registrationId: string | null; registrationIds: Prisma.JsonValue },
  registrationIds: Set<string>,
): boolean {
  if (delivery.registrationId && registrationIds.has(delivery.registrationId)) return true;
  return Array.isArray(delivery.registrationIds) && delivery.registrationIds.some((id) => typeof id === 'string' && registrationIds.has(id));
}

async function pruneUnusedParentArtifacts(tx: Prisma.TransactionClient, affectedEmails: string[]): Promise<void> {
  const normalized = [...new Set(affectedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();
  if (!normalized.length) return;
  for (const email of normalized) {
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(0, hashtext(${email}))) AS _lock`);
  }
  const remaining = await tx.registration.findMany({
    where: { parentEmail: { in: normalized, mode: 'insensitive' }, anonymizedAt: null },
    select: { parentEmail: true },
  });
  const retained = new Set(remaining.map((registration) => registration.parentEmail.trim().toLowerCase()));
  const unused = normalized.filter((email) => !retained.has(email));
  if (!unused.length) return;
  const emailFilter = { in: unused, mode: 'insensitive' as const };
  await tx.parentAccessSession.deleteMany({ where: { email: emailFilter } });
  await tx.parentAccessToken.deleteMany({ where: { email: emailFilter } });
}

async function scrubPlanWarnings(
  tx: Prisma.TransactionClient,
  eventId: string,
  registrationIds: string[],
): Promise<void> {
  const ids = new Set(registrationIds);
  const plans = await tx.roundPlan.findMany({
    where: { eventId },
    select: { id: true, validationWarnings: true },
  });
  for (const plan of plans) {
    if (!Array.isArray(plan.validationWarnings)) continue;
    const retained = plan.validationWarnings.filter((warning) => {
      if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return true;
      const detail = (warning as { detail?: unknown }).detail;
      return !detail || typeof detail !== 'object' || Array.isArray(detail) ||
        !ids.has((detail as { registrationId?: string }).registrationId ?? '');
    });
    if (retained.length !== plan.validationWarnings.length) {
      await tx.roundPlan.update({ where: { id: plan.id }, data: { validationWarnings: retained } });
    }
  }
}

async function rewritePlanReferences(tx: Prisma.TransactionClient, mappings: AnonymizedReference[]): Promise<void> {
  if (!mappings.length) return;
  const ids = Prisma.join(mappings.map(({ registrationId }) => registrationId));
  const playerCases = Prisma.join(mappings.map(({ registrationId, anonymizedRef }) =>
    Prisma.sql`WHEN ${registrationId} THEN ${anonymizedRef}`,
  ), ' ');
  const slotCases = Prisma.join(mappings.map(({ registrationId, anonymizedRef }) =>
    Prisma.sql`WHEN ${registrationId} THEN ${anonymizedRef}`,
  ), ' ');
  await tx.$executeRaw(Prisma.sql`
    UPDATE "RoundPlanPlayer"
    SET "registrationId" = CASE "registrationId" ${playerCases} ELSE "registrationId" END,
        "playerName" = 'Former participant',
        "bibNumber" = NULL
    WHERE "registrationId" IN (${ids})
  `);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "RoundSlot"
    SET "registrationId" = CASE "registrationId" ${slotCases} ELSE "registrationId" END
    WHERE "registrationId" IN (${ids})
  `);
}

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
        select: { id: true, status: true, parentEmail: true },
      });
      const rewritten: AnonymizedReference[] = [];
      for (const registration of registrations) {
        const anonymizedRef = `anon_${randomUUID()}`;
        const claimed = await tx.registration.updateMany({
          where: { id: registration.id, anonymizedAt: null },
          data: {
            playerFirstName: '', playerLastName: '', playerNameNormalized: '',
            dateOfBirth: ANONYMIZED_DOB, parentAuthorityConfirmedAt: null,
            parentName: '', parentEmail: '', parentMobile: '', memberAssociation: '',
            qrToken: null, checkoutSessionId: null, paymentIntentId: null, legacyPaymentRef: null,
            checkedInBy: null, bibNumber: null, ageFlagged: false, removalNote: null, duplicateOfRegistrationId: null,
            statusBeforeAnonymization: registration.status,
            status: 'WITHDRAWN', anonymizedAt: now, anonymizedRef,
          },
        });
        if (claimed.count === 1) rewritten.push({ registrationId: registration.id, anonymizedRef });
      }
      const registrationIds = rewritten.map(({ registrationId }) => registrationId);
      if (registrationIds.length) {
        await tx.reviewItem.deleteMany({
          where: { registrationId: { in: registrationIds }, OR: [{ reason: { not: ORPHANED_PAYMENT_REVIEW_REASON } }, { resolvedAt: { not: null } }] },
        });
        await tx.registrationChangeLog.deleteMany({ where: { registrationId: { in: registrationIds } } });
        await tx.parentAccessToken.deleteMany({ where: { registrationId: { in: registrationIds } } });
        await rewritePlanReferences(tx, rewritten);
        await pruneUnusedParentArtifacts(tx, registrations.map((registration) => registration.parentEmail));
      }

      const existingEventIds = await tx.event.findMany({ select: { id: true } }).then((rows) => new Set(rows.map((row) => row.id)));
      const campaigns = await tx.siteAssociationCommunication.findMany({
        where: { anchorEventId: eventId },
        select: { id: true, eventIds: true },
      });
      const expiredSet = new Set(expiredEventIds);
      const deletableCampaigns = campaigns.filter((campaign) => {
        const eventIds = Array.isArray(campaign.eventIds) ? campaign.eventIds : [];
        return eventIds.length === 0 || eventIds.every((referencedEventId) =>
          typeof referencedEventId === 'string' && (!existingEventIds.has(referencedEventId) || expiredSet.has(referencedEventId)),
        );
      });
      const retainedCampaignIds = campaigns
        .filter((campaign) => !deletableCampaigns.includes(campaign))
        .map((campaign) => campaign.id);
      const excludeRetainedCampaigns = retainedCampaignIds.length
        ? Prisma.sql`AND ("siteCommunicationId" IS NULL OR "siteCommunicationId" NOT IN (${Prisma.join(retainedCampaignIds)}))`
        : Prisma.empty;

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
            "registrationIds" = NULL,
            "status" = 'ANONYMIZED',
            "updatedAt" = ${now}
        WHERE "eventId" = ${eventId} AND "status" <> 'ANONYMIZED'
          ${excludeRetainedCampaigns}
      `);
      await tx.reviewItem.deleteMany({
        where: { eventId, OR: [{ reason: { not: ORPHANED_PAYMENT_REVIEW_REASON } }, { resolvedAt: { not: null } }] },
      });
      await tx.reviewItem.updateMany({
        where: { eventId, reason: ORPHANED_PAYMENT_REVIEW_REASON, resolvedAt: null },
        data: { note: null, resolutionHistory: Prisma.DbNull },
      });
      await tx.roundPlan.updateMany({ where: { eventId }, data: { validationWarnings: [] } });
      await tx.rosterSnapshot.updateMany({ where: { eventId }, data: { data: { scrubbed: true } } });
      await tx.auditEvent.updateMany({
        where: { eventId },
        data: { actorEmailSnapshot: null, reason: null, beforeState: Prisma.DbNull, afterState: Prisma.DbNull, metadata: Prisma.DbNull },
      });
      await tx.scheduledMessage.deleteMany({ where: { eventId } });
      await tx.siteAssociationCommunication.deleteMany({ where: { id: { in: deletableCampaigns.map((campaign) => campaign.id) } } });
      await tx.checkInSession.deleteMany({ where: { eventId } });
      return rewritten.length;
    }, { timeout: 60_000 });
    if (deferred) onDeferred?.(deferred);
  }
  return anonymized;
}

export async function anonymizeIncompleteRegistrations(
  prisma: PrismaClient,
  now: Date,
  onDeferred?: (deferral: RetentionDeferral) => void,
): Promise<number> {
  const cutoff = new Date(now.getTime() - INCOMPLETE_REGISTRATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const incompleteStatuses: Prisma.RegistrationWhereInput = {
    OR: [
      { status: { in: ['PENDING', 'EXPIRED', 'FAILED'] } },
      { status: 'WITHDRAWN', paidAt: null },
    ],
  };
  const candidates = await prisma.registration.findMany({
    where: {
      createdAt: { lt: cutoff },
      ...incompleteStatuses,
      anonymizedAt: null,
    },
    select: { id: true, eventId: true, status: true, parentEmail: true },
    orderBy: [{ eventId: 'asc' }, { id: 'asc' }],
  });
  if (candidates.length === 0) return 0;

  const byEvent = new Map<string, typeof candidates>();
  for (const candidate of candidates) byEvent.set(candidate.eventId, [...(byEvent.get(candidate.eventId) ?? []), candidate]);

  let anonymized = 0;
  for (const [eventId, rows] of byEvent) {
    let deferred: RetentionDeferral | undefined;
    anonymized += await prisma.$transaction(async (tx) => {
      const event = await lockMailEvent(tx, eventId);
      if (!event) return 0;
      const ids = rows.map((row) => row.id);
      const idSet = new Set(ids);
      const active = (await tx.emailLog.findMany({
        where: { eventId, OR: [{ status: 'SENDING' }, { status: 'AMBIGUOUS', error: INTERRUPTED_SEND }] },
        select: { id: true, attempts: true, status: true, registrationId: true, registrationIds: true },
        orderBy: { id: 'asc' },
      })).filter((delivery) => deliveryTouchesRegistrations(delivery, idSet));
      if (active.length > 0) {
        deferred = { eventId, deliveries: active };
        return 0;
      }

      const expired = await tx.registration.findMany({
        where: { id: { in: ids }, ...incompleteStatuses, anonymizedAt: null },
        select: { id: true, status: true, parentEmail: true },
      });
      const rewritten: AnonymizedReference[] = [];
      for (const registration of expired) {
        const anonymizedRef = `anon_${randomUUID()}`;
        const claimed = await tx.registration.updateMany({
          where: { id: registration.id, ...incompleteStatuses, anonymizedAt: null },
          data: {
            playerFirstName: '', playerLastName: '', playerNameNormalized: '', dateOfBirth: ANONYMIZED_DOB,
            parentAuthorityConfirmedAt: null, parentEmailVerifiedAt: null, parentFollowUpSentAt: null,
            parentName: '', parentEmail: '', parentMobile: '', memberAssociation: '',
            qrToken: null, checkoutSessionId: null, paymentIntentId: null, legacyPaymentRef: null,
            checkedInBy: null, bibNumber: null, ageFlagged: false, removalNote: null, duplicateOfRegistrationId: null,
            statusBeforeAnonymization: registration.status, status: 'WITHDRAWN', anonymizedAt: now, anonymizedRef,
          },
        });
        if (claimed.count === 1) rewritten.push({ registrationId: registration.id, anonymizedRef });
      }
      const registrationIds = rewritten.map(({ registrationId }) => registrationId);
      if (registrationIds.length) {
        await tx.parentAccessToken.deleteMany({ where: { registrationId: { in: registrationIds } } });
        await tx.registrationChangeLog.deleteMany({ where: { registrationId: { in: registrationIds } } });
        await tx.auditEvent.updateMany({
          where: { eventId, registrationId: { in: registrationIds } },
          data: { actorEmailSnapshot: null, reason: null, beforeState: Prisma.DbNull, afterState: Prisma.DbNull, metadata: Prisma.DbNull },
        });
        await tx.reviewItem.deleteMany({
          where: { registrationId: { in: registrationIds }, OR: [{ reason: { not: ORPHANED_PAYMENT_REVIEW_REASON } }, { resolvedAt: { not: null } }] },
        });
        await tx.reviewItem.updateMany({
          where: { registrationId: { in: registrationIds }, reason: ORPHANED_PAYMENT_REVIEW_REASON, resolvedAt: null },
          data: { note: null, resolutionHistory: Prisma.DbNull },
        });
        await rewritePlanReferences(tx, rewritten);
        await scrubPlanWarnings(tx, eventId, registrationIds);
        const deliveries = await tx.emailLog.findMany({
          where: { eventId, status: { not: 'ANONYMIZED' } },
          select: { id: true, registrationId: true, registrationIds: true, kind: true, status: true },
        });
        const expiredIds = new Set(registrationIds);
        const scrubIds: string[] = [];
        for (const delivery of deliveries) {
          if (!deliveryTouchesRegistrations(delivery, expiredIds)) continue;
          const groupedIds = Array.isArray(delivery.registrationIds)
            ? delivery.registrationIds.filter((id): id is string => typeof id === 'string' && !expiredIds.has(id))
            : [];
          const retainedIds = [...new Set([
            ...(delivery.registrationId && !expiredIds.has(delivery.registrationId) ? [delivery.registrationId] : []),
            ...groupedIds,
          ])];
          if (retainedIds.length === 0) {
            scrubIds.push(delivery.id);
            continue;
          }
          await tx.emailLog.update({
            where: { id: delivery.id },
            data: {
              registrationId: retainedIds.includes(delivery.registrationId ?? '') ? delivery.registrationId : retainedIds[0],
              ...(Array.isArray(delivery.registrationIds) ? { registrationIds: groupedIds } : {}),
              ...(delivery.kind === 'email-change' ? {} : {
                subject: '', body: '', messagePayload: Prisma.DbNull,
                status: delivery.status === 'SENT' ? 'SENT' : 'ANONYMIZED',
              }),
            },
          });
        }
        if (scrubIds.length) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "EmailLog"
            SET "registrationId" = NULL,
                "batchId" = 'retained:' || "id",
                "idempotencyKey" = 'retained:' || "id",
                "to" = '', "subject" = '', "body" = '', "messagePayload" = NULL,
                "error" = NULL, "kind" = 'retention', "registrationIds" = NULL, "status" = 'ANONYMIZED', "updatedAt" = ${now}
            WHERE "id" IN (${Prisma.join(scrubIds)}) AND "status" <> 'ANONYMIZED'
          `);
        }
      }
      await pruneUnusedParentArtifacts(tx, expired.map((registration) => registration.parentEmail));
      return rewritten.length;
    }, { timeout: 60_000 });
    if (deferred) onDeferred?.(deferred);
  }
  return anonymized;
}

export async function pruneParentAccessArtifacts(prisma: PrismaClient, now: Date): Promise<{ tokens: number; sessions: number }> {
  const [tokens, sessions] = await Promise.all([
    prisma.parentAccessToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.parentAccessSession.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { tokens: tokens.count, sessions: sessions.count };
}

export async function pruneStaffAuthArtifacts(prisma: PrismaClient, now: Date): Promise<{ tokens: number; sessions: number }> {
  const [tokens, sessions] = await Promise.all([
    prisma.loginToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { tokens: tokens.count, sessions: sessions.count };
}

const RATE_LIMIT_BUCKET_TTL_MS = 24 * 60 * 60 * 1000;

export async function pruneEventlessAuditEvents(prisma: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - APPLICATION_RETENTION_YEARS);
  return prisma.auditEvent.deleteMany({ where: { eventId: null, createdAt: { lt: cutoff } } }).then((result) => result.count);
}

export async function pruneRateLimitBuckets(prisma: PrismaClient, now: Date): Promise<number> {
  const result = await prisma.requestRateLimitBucket.deleteMany({
    where: { updatedAt: { lt: new Date(now.getTime() - RATE_LIMIT_BUCKET_TTL_MS) } },
  });
  return result.count;
}
