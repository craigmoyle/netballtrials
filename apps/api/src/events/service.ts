import type { Event, PrismaClient } from '@prisma/client';
import {
  EventValidationError,
  eventInputSchema,
  eventPatchSchema,
  validateWindow,
  type EventInput,
  type EventPatch,
} from './schemas';

function toEventData(input: EventInput) {
  return {
    name: input.name,
    competitionYear: input.competitionYear,
    division: input.division,
    section: input.section,
    eventDate: new Date(`${input.eventDate}T00:00:00.000Z`),
    venue: input.venue,
    startTime: input.startTime,
    endTime: input.endTime,
    firstWhistle: input.firstWhistle,
    lastWhistle: input.lastWhistle,
    registrationFeeCents: input.registrationFeeCents,
    courts: input.courts,
    rank1Min: input.rank1Min,
    rank2Min: input.rank2Min,
    rank3Min: input.rank3Min,
    playMinutes: input.playMinutes,
    changeoverMinutes: input.changeoverMinutes,
    minAge: input.minAge,
    maxAge: input.maxAge,
    policyUrl: input.policyUrl ?? null,
  };
}

function assertValid(input: EventInput): EventInput {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new EventValidationError(parsed.error.issues.map((issue) => String(issue.path[0])));
  }

  const windowErrors = validateWindow(parsed.data);
  if (windowErrors.length > 0) {
    throw new EventValidationError(windowErrors);
  }

  if (parsed.data.minAge > parsed.data.maxAge) {
    throw new EventValidationError(['maxAge']);
  }

  return parsed.data;
}

export async function createEvent(prisma: PrismaClient, input: EventInput): Promise<Event> {
  const valid = assertValid(input);
  return prisma.event.create({ data: toEventData(valid) });
}

export async function listEvents(prisma: PrismaClient): Promise<Event[]> {
  return prisma.event.findMany({ orderBy: [{ eventDate: 'asc' }, { name: 'asc' }] });
}

export async function getEvent(prisma: PrismaClient, id: string): Promise<Event | null> {
  return prisma.event.findUnique({ where: { id } });
}

export async function updateEvent(
  prisma: PrismaClient,
  id: string,
  patch: EventPatch,
): Promise<Event | null> {
  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  const merged = {
    name: existing.name,
    competitionYear: existing.competitionYear,
    division: existing.division,
    section: existing.section,
    eventDate: existing.eventDate.toISOString().slice(0, 10),
    venue: existing.venue,
    startTime: existing.startTime,
    endTime: existing.endTime,
    firstWhistle: existing.firstWhistle,
    lastWhistle: existing.lastWhistle,
    registrationFeeCents: existing.registrationFeeCents,
    courts: existing.courts,
    rank1Min: existing.rank1Min,
    rank2Min: existing.rank2Min,
    rank3Min: existing.rank3Min,
    playMinutes: existing.playMinutes,
    changeoverMinutes: existing.changeoverMinutes,
    minAge: existing.minAge,
    maxAge: existing.maxAge,
    policyUrl: existing.policyUrl ?? undefined,
    ...patch,
  };

  const valid = assertValid(merged as EventInput);
  return prisma.event.update({ where: { id }, data: toEventData(valid) });
}
