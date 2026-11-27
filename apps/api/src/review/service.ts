import { Prisma, type PrismaClient } from '@prisma/client';
import type { ReviewItemDTO } from '@netball-trials/types';

type ItemWithRegistration = Prisma.ReviewItemGetPayload<{
  include: { registration: true; emailLog: { select: { id: true; status: true; attempts: true; to: true } } };
}>;

export const ORPHANED_PAYMENT_REVIEW_REASON = 'payment_without_registration';

function attentionLink(eventId: string, reason: string): { path: string; label: string } {
  if (reason.startsWith('delivery_') || reason === 'scheduled_message_failed') {
    return { path: `/admin/events/${eventId}/communications`, label: 'Open communications' };
  }
  if (reason === 'planner_reconciliation') return { path: `/admin/events/${eventId}/plan`, label: 'Open planner' };
  if (['registration_incomplete', 'late_addition_incomplete', 'checkout_creation_failed', 'email_verification_failed'].includes(reason)) {
    return { path: `/admin/events/${eventId}/incomplete`, label: 'Open incomplete registrations' };
  }
  return { path: `/admin/events/${eventId}/roster`, label: 'Open roster' };
}

function toDTO(item: ItemWithRegistration): ReviewItemDTO {
  return {
    id: item.id,
    reason: item.reason,
    note: item.note,
    emailLogId: item.emailLogId,
    dedupeKey: item.dedupeKey,
    delivery: item.emailLog ? { ...item.emailLog, status: item.emailLog.status } : null,
    createdAt: item.createdAt.toISOString(),
    resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
    resolvedByUserId: item.resolvedByUserId,
    resolutionHistory: item.resolutionHistory,
    registration: item.registration ? {
      id: item.registration.id,
      playerName: `${item.registration.playerFirstName} ${item.registration.playerLastName}`.trim(),
      bibNumber: item.registration.checkedInAt ? item.registration.bibNumber : null,
      ageFlagged: item.registration.ageFlagged,
    } : null,
    link: attentionLink(item.eventId ?? '', item.reason),
  };
}

function warningText(warnings: unknown): string | null {
  if (!Array.isArray(warnings)) return null;
  const messages = warnings.map((warning) => typeof warning === 'object' && warning !== null && 'message' in warning
    ? String(warning.message) : '').filter(Boolean);
  return messages.length ? messages.join(' ') : null;
}

/** Materialise read-time projections into the existing durable review queue once. */
export async function ensureReviewItems(prisma: PrismaClient, eventId: string): Promise<number> {
  const [flagged, incomplete, deliveries, scheduled, siteScheduled, latestPlan] = await Promise.all([
    prisma.registration.findMany({
      where: { eventId, status: 'PAID', ageFlagged: true, reviewItems: { none: { reason: 'age_out_of_range' } } },
      select: { id: true },
    }),
    prisma.registration.findMany({
      where: {
        eventId, anonymizedAt: null,
        OR: [
          { status: { in: ['EXPIRED', 'FAILED'] } },
          { status: 'PENDING', adminAssistedAt: { not: null } },
        ],
      },
      select: { id: true, adminAssistedAt: true },
    }),
    prisma.emailLog.findMany({
      where: { eventId, status: { in: ['FAILED', 'AMBIGUOUS'] } },
      select: { id: true, registrationId: true, registrationIds: true, status: true, error: true },
    }),
    prisma.scheduledMessage.findMany({
      where: { eventId, status: 'FAILED' },
      select: { id: true, error: true },
    }),
    prisma.siteAssociationCommunication.findMany({
      where: { anchorEventId: eventId, status: 'FAILED' }, select: { id: true, error: true },
    }),
    prisma.roundPlan.findFirst({
      where: { eventId }, orderBy: [{ revision: 'desc' }], select: { id: true, validationWarnings: true },
    }),
  ]);

  const data: Prisma.ReviewItemCreateManyInput[] = [
    ...flagged.map((registration) => ({
      eventId, registrationId: registration.id, reason: 'age_out_of_range', dedupeKey: `registration:${registration.id}:age_out_of_range`,
    })),
    ...incomplete.map((registration) => {
      const reason = registration.adminAssistedAt ? 'late_addition_incomplete' : 'registration_incomplete';
      return {
        eventId, registrationId: registration.id, reason,
        dedupeKey: `registration:${registration.id}:${reason}`,
      };
    }),
    ...deliveries.map((delivery) => ({
      eventId,
      registrationId: delivery.registrationId ?? (Array.isArray(delivery.registrationIds)
        ? delivery.registrationIds.find((id): id is string => typeof id === 'string') ?? null : null),
      emailLogId: delivery.id,
      reason: delivery.status === 'AMBIGUOUS' ? 'delivery_ambiguous' : 'delivery_failed',
      note: delivery.error,
      dedupeKey: `email:${delivery.id}:${delivery.status.toLowerCase()}`,
    })),
    ...scheduled.map((message) => ({
      eventId, registrationId: null, reason: 'scheduled_message_failed', note: message.error,
      dedupeKey: `scheduled:${message.id}:failed`,
    })),
    ...siteScheduled.map((message) => ({
      eventId, registrationId: null, reason: 'scheduled_message_failed', note: message.error,
      dedupeKey: `site-scheduled:${message.id}:failed`,
    })),
    ...(latestPlan && warningText(latestPlan.validationWarnings) ? [{
      eventId, registrationId: null, reason: 'planner_reconciliation',
      note: warningText(latestPlan.validationWarnings), dedupeKey: `plan:${latestPlan.id}:warnings`,
    }] : []),
  ];
  if (data.length === 0) return 0;
  return (await prisma.reviewItem.createMany({ data, skipDuplicates: true })).count;
}

export async function listReviewQueue(
  prisma: PrismaClient,
  eventId: string,
  includeResolved = false,
): Promise<ReviewItemDTO[]> {
  const items = await prisma.reviewItem.findMany({
    where: { eventId, ...(includeResolved ? {} : { resolvedAt: null }) },
    orderBy: [{ resolvedAt: 'asc' }, { createdAt: 'asc' }],
    include: { registration: true, emailLog: { select: { id: true, status: true, attempts: true, to: true } } },
  });
  return items.map(toDTO);
}

export async function resolveReviewItem(
  prisma: PrismaClient,
  eventId: string,
  itemId: string,
  resolution: { resolvedByUserId: string; note?: string | null },
  now: Date,
): Promise<ReviewItemDTO | null> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.reviewItem.findFirst({
      where: { id: itemId, eventId },
      include: { registration: true, emailLog: { select: { id: true, status: true, attempts: true, to: true } } },
    });
    if (!existing || existing.resolvedAt) return existing ? toDTO(existing) : null;
    const resolutionNote = resolution.note?.trim() || null;
    const note = existing.note && resolutionNote ? `${existing.note}\n\nResolution: ${resolutionNote}` : existing.note ?? resolutionNote;
    const previousHistory = Array.isArray(existing.resolutionHistory) ? existing.resolutionHistory : [];
    const resolutionEntry = {
      actorUserId: resolution.resolvedByUserId,
      action: 'resolved',
      reason: resolutionNote ?? 'Reviewed',
      at: now.toISOString(),
      registrationState: existing.registration ? {
        status: existing.registration.status,
        paidAt: existing.registration.paidAt?.toISOString() ?? null,
        checkedInAt: existing.registration.checkedInAt?.toISOString() ?? null,
      } : null,
      deliveryState: existing.emailLog ? {
        id: existing.emailLog.id,
        status: existing.emailLog.status,
        attempts: existing.emailLog.attempts,
      } : null,
    };
    const claimed = await tx.reviewItem.updateMany({
      where: { id: itemId, eventId, resolvedAt: null },
      data: {
        resolvedAt: now, resolvedByUserId: resolution.resolvedByUserId, note,
        resolutionHistory: [...previousHistory, resolutionEntry] as Prisma.InputJsonValue,
      },
    });
    if (claimed.count !== 1) {
      const current = await tx.reviewItem.findFirst({
        where: { id: itemId, eventId },
        include: { registration: true, emailLog: { select: { id: true, status: true, attempts: true, to: true } } },
      });
      return current ? toDTO(current) : null;
    }
    const updated = await tx.reviewItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { registration: true, emailLog: { select: { id: true, status: true, attempts: true, to: true } } },
    });
    const actor = await tx.staffUser.findUnique({ where: { id: resolution.resolvedByUserId }, select: { id: true } });
    await tx.auditEvent.create({ data: {
      eventId, registrationId: existing.registrationId, actorType: 'ADMIN', actorUserId: actor?.id,
      action: 'REVIEW_ITEM_RESOLVED', entityType: 'ReviewItem', entityId: itemId, reason: resolutionNote ?? 'Reviewed',
      beforeState: { resolvedAt: null, reason: existing.reason, delivery: existing.emailLog },
      afterState: { resolvedAt: now.toISOString(), reason: existing.reason }, createdAt: now,
    } });
    return toDTO(updated);
  });
}
