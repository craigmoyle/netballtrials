import type { PrismaClient } from '@prisma/client';
import type { RegistrationOverviewEventDTO } from '@netball-trials/types';
import { isPastRetentionCutoff } from '../retention/service';
import { localDateTimeToUtc } from '../time/melbourne';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRIOR_YEARS = 4;

type OverviewEvent = {
  id: string;
  name: string;
  competitionYear: number;
  division: string;
  section: string;
  eventDate: Date;
  startTime: string;
};

export async function getRegistrationOverview(prisma: PrismaClient, now: Date): Promise<RegistrationOverviewEventDTO[]> {
  const openEvents = await prisma.event.findMany({
    where: { status: 'OPEN' },
    select: { id: true, name: true, competitionYear: true, division: true, section: true, eventDate: true, startTime: true },
    orderBy: [{ eventDate: 'asc' }, { division: 'asc' }, { section: 'asc' }, { id: 'asc' }],
  });
  if (openEvents.length === 0) return [];

  const minYear = Math.min(...openEvents.map((event) => event.competitionYear - PRIOR_YEARS));
  const maxYear = Math.max(...openEvents.map((event) => event.competitionYear - 1));
  const comparisonGroups = new Set(openEvents.map((event) => `${event.division}\u0000${event.section}`));
  const historicalEvents = maxYear < minYear ? [] : (await prisma.event.findMany({
    where: { status: 'CLOSED', competitionYear: { gte: minYear, lte: maxYear } },
    select: { id: true, name: true, competitionYear: true, division: true, section: true, eventDate: true, startTime: true },
    orderBy: [{ competitionYear: 'desc' }, { eventDate: 'desc' }, { id: 'asc' }],
  })).filter((event) =>
    comparisonGroups.has(`${event.division}\u0000${event.section}`) && !isPastRetentionCutoff(event.eventDate, now),
  );
  const eventsByGroup = new Map<string, OverviewEvent[]>();
  for (const event of historicalEvents) {
    const group = `${event.division}\u0000${event.section}`;
    const events = eventsByGroup.get(group) ?? [];
    events.push(event);
    eventsByGroup.set(group, events);
  }

  const eventIds = [...openEvents, ...historicalEvents].map((event) => event.id);
  const registrations = await prisma.registration.findMany({
    where: { eventId: { in: eventIds }, anonymizedAt: null },
    select: { eventId: true, status: true, expiresAt: true, paidAt: true },
  });
  const registrationsByEvent = new Map<string, typeof registrations>();
  for (const registration of registrations) {
    const rows = registrationsByEvent.get(registration.eventId) ?? [];
    rows.push(registration);
    registrationsByEvent.set(registration.eventId, rows);
  }

  return openEvents.map((event) => {
    const start = localDateTimeToUtc(event.eventDate, event.startTime);
    const leadTimeMs = Math.max(0, start.getTime() - now.getTime());
    const currentRegistrations = registrationsByEvent.get(event.id) ?? [];
    const priorYears = (eventsByGroup.get(`${event.division}\u0000${event.section}`) ?? [])
      .filter((historical) => historical.competitionYear < event.competitionYear && historical.competitionYear >= event.competitionYear - PRIOR_YEARS)
      .map((historical) => {
        const historicalStart = localDateTimeToUtc(historical.eventDate, historical.startTime);
        const historicalCutoff = new Date(historicalStart.getTime() - leadTimeMs);
        const paid = registrationsByEvent.get(historical.id) ?? [];
        return {
          competitionYear: historical.competitionYear,
          paidRegistrationsAtSameLeadTime: paid.filter((registration) => registration.paidAt !== null && registration.paidAt <= historicalCutoff).length,
        };
      });

    return {
      id: event.id,
      name: event.name,
      competitionYear: event.competitionYear,
      division: event.division,
      section: event.section,
      eventDate: event.eventDate.toISOString(),
      startTime: event.startTime,
      paidRegistrations: currentRegistrations.filter((registration) => registration.status === 'PAID').length,
      paidWithdrawals: currentRegistrations.filter((registration) => registration.status === 'WITHDRAWN' && registration.paidAt !== null && registration.paidAt <= now).length,
      pendingRegistrations: currentRegistrations.filter((registration) => registration.status === 'PENDING' && registration.paidAt === null && registration.expiresAt > now).length,
      daysUntilStart: Math.ceil(leadTimeMs / DAY_MS),
      priorYears,
    };
  });
}
