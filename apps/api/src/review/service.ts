import type { Prisma, PrismaClient } from '@prisma/client';
import type { ReviewItemDTO } from '@netball-trials/types';

type ItemWithRegistration = Prisma.ReviewItemGetPayload<{ include: { registration: true } }>;

function toDTO(item: ItemWithRegistration): ReviewItemDTO {
  return {
    id: item.id,
    reason: item.reason,
    note: item.note,
    resolvedAt: item.resolvedAt ? item.resolvedAt.toISOString() : null,
    resolvedByUserId: item.resolvedByUserId,
    resolutionHistory: item.resolutionHistory,
    registration: {
      id: item.registration.id,
      playerName: `${item.registration.playerFirstName} ${item.registration.playerLastName}`,
      bibNumber: item.registration.checkedInAt ? item.registration.bibNumber : null,
      ageFlagged: item.registration.ageFlagged,
    },
  };
}

export async function ensureReviewItems(prisma: PrismaClient, eventId: string): Promise<number> {
  const flagged = await prisma.registration.findMany({
    where: {
      eventId,
      status: 'PAID',
      ageFlagged: true,
      reviewItems: { none: { reason: 'age_out_of_range' } },
    },
    select: { id: true },
  });
  if (flagged.length === 0) {
    return 0;
  }

  const result = await prisma.reviewItem.createMany({
    data: flagged.map((registration) => ({
      eventId,
      registrationId: registration.id,
      reason: 'age_out_of_range',
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function listReviewQueue(
  prisma: PrismaClient,
  eventId: string,
  includeResolved = false,
): Promise<ReviewItemDTO[]> {
  const items = await prisma.reviewItem.findMany({
    where: {
      eventId,
      ...(includeResolved ? {} : {
        resolvedAt: null,
        // Orphaned payments belong to registrations that are no longer PAID
        // by definition, so they must stay visible until resolved.
        OR: [
          { reason: 'payment_without_registration' },
          {
            registration: { is: { status: 'PAID' } },
            OR: [
              { reason: { not: 'age_out_of_range' } },
              { registration: { is: { ageFlagged: true } } },
            ],
          },
        ],
      }),
    },
    orderBy: { createdAt: 'asc' },
    include: { registration: true },
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
  const existing = await prisma.reviewItem.findFirst({ where: { id: itemId, eventId }, select: { note: true } });
  const resolutionNote = resolution.note?.trim() || null;
  const note = existing?.note && resolutionNote
    ? `${existing.note}\n\nResolution: ${resolutionNote}`
    : existing?.note ?? resolutionNote;
  const result = await prisma.reviewItem.updateMany({
    where: { id: itemId, eventId, resolvedAt: null },
    data: {
      resolvedAt: now,
      resolvedByUserId: resolution.resolvedByUserId,
      note,
    },
  });

  const item = await prisma.reviewItem.findFirst({
    where: { id: itemId, eventId },
    include: { registration: true },
  });
  if (!item) {
    return null;
  }
  if (result.count === 0 && item.resolvedAt === null) {
    return null;
  }
  return toDTO(item);
}
