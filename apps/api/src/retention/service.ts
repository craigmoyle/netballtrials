import type { PrismaClient } from '@prisma/client';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function anonymizeExpiredRegistrations(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - YEAR_MS);
  const events = await prisma.event.findMany({
    where: { eventDate: { lt: cutoff } },
    select: { id: true },
  });
  if (events.length === 0) {
    return 0;
  }

  const result = await prisma.registration.updateMany({
    where: { eventId: { in: events.map((event) => event.id) } },
    data: {
      playerFirstName: '',
      playerLastName: '',
      playerNameNormalized: '',
      dateOfBirth: new Date('1900-01-01T00:00:00Z'),
      parentName: '',
      parentEmail: '',
      parentMobile: '',
      qrToken: null,
      status: 'WITHDRAWN',
    },
  });
  return result.count;
}
