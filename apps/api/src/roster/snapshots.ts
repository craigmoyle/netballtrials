import { Prisma } from '@prisma/client';

export async function appendRosterSnapshot(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const latest = await tx.rosterSnapshot.findFirst({
    where: { eventId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  const registrations = await tx.registration.findMany({
    where: { eventId, status: 'PAID', checkedInAt: { not: null }, anonymizedAt: null },
    orderBy: [{ bibNumber: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      playerFirstName: true,
      playerLastName: true,
      memberAssociation: true,
      rank1Position: true,
      rank2Position: true,
      rank3Position: true,
      optInExtraPositions: true,
      bibNumber: true,
      status: true,
      checkedInAt: true,
      removedAt: true,
      removalReason: true,
      removalNote: true,
      duplicateOfRegistrationId: true,
    },
  });
  await tx.rosterSnapshot.create({
    data: {
      eventId,
      revision: (latest?.revision ?? 0) + 1,
      reconstructed: false,
      data: { registrations } as unknown as Prisma.InputJsonValue,
    },
  });
}
