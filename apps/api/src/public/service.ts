import type { PrismaClient } from '@prisma/client';

export type PublicEvent = {
  id: string;
  name: string;
  division: string;
  section: string;
  eventDate: string;
  venue: string;
  firstWhistle: string;
  registrationFeeCents: number;
  currency: string;
  policyUrl: string | null;
  minAge: number;
  maxAge: number;
  courts: number;
  status: string;
};

export type PublicTicket = {
  playerName: string;
  event: { name: string; eventDate: string; venue: string; firstWhistle: string };
  bibNumber: number | null;
};

export async function getTicket(
  prisma: PrismaClient,
  token: string,
): Promise<PublicTicket | null> {
  const registration = await prisma.registration.findFirst({
    where: { qrToken: token, status: 'PAID' },
    include: { event: true },
  });

  if (!registration) {
    return null;
  }

  return {
    playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    event: {
      name: registration.event.name,
      eventDate: registration.event.eventDate.toISOString(),
      venue: registration.event.venue,
      firstWhistle: registration.event.firstWhistle,
    },
    bibNumber: registration.bibNumber,
  };
}

export async function getPublicEvent(
  prisma: PrismaClient,
  id: string,
): Promise<PublicEvent | null> {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || event.status !== 'OPEN') {
    return null;
  }

  return {
    id: event.id,
    name: event.name,
    division: event.division,
    section: event.section,
    eventDate: event.eventDate.toISOString(),
    venue: event.venue,
    firstWhistle: event.firstWhistle,
    registrationFeeCents: event.registrationFeeCents,
    currency: 'aud',
    policyUrl: event.policyUrl,
    minAge: event.minAge,
    maxAge: event.maxAge,
    courts: event.courts,
    status: event.status,
  };
}
