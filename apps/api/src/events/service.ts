import type { Event, EventStatus, PrismaClient } from '@prisma/client';
import { DEFAULT_POLICY_URL } from '../policy';
import { ageAtDecember31, isAgeInRange } from '../registrations/eligibility';
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
    policyUrl: input.policyUrl ?? DEFAULT_POLICY_URL,
  };
}

function assertValid(input: unknown): EventInput {
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

export class EventLifecycleError extends Error {
  constructor() {
    super('Invalid event lifecycle transition');
    this.name = 'EventLifecycleError';
  }
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

  const parsedPatch = eventPatchSchema.safeParse(patch);
  if (!parsedPatch.success) {
    throw new EventValidationError(parsedPatch.error.issues.map((issue) => String(issue.path[0])));
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
    policyUrl: existing.policyUrl ?? DEFAULT_POLICY_URL,
    ...parsedPatch.data,
  };
  const valid = assertValid(merged);
  const ageSettingsChanged = valid.competitionYear !== existing.competitionYear ||
    valid.minAge !== existing.minAge || valid.maxAge !== existing.maxAge;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({ where: { id }, data: toEventData(valid) });
    if (ageSettingsChanged) {
      const registrations = await tx.registration.findMany({
        where: { eventId: id, status: { in: ['PENDING', 'PAID'] } },
        select: { id: true, dateOfBirth: true, ageFlagged: true },
      });
      for (const registration of registrations) {
        const age = ageAtDecember31(registration.dateOfBirth, valid.competitionYear);
        const ageFlagged = !isAgeInRange(age, valid.minAge, valid.maxAge);
        if (ageFlagged !== registration.ageFlagged) {
          await tx.registration.updateMany({
            where: { id: registration.id, ageFlagged: registration.ageFlagged },
            data: { ageFlagged },
          });
        }
      }
    }
    return updated;
  });
}

async function transitionEvent(
  prisma: PrismaClient,
  id: string,
  from: EventStatus,
  to: EventStatus,
): Promise<Event | null> {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return null;
  if (event.status === to) return event;
  if (event.status !== from) throw new EventLifecycleError();

  const changed = await prisma.event.updateMany({ where: { id, status: from }, data: { status: to } });
  if (changed.count === 1) return prisma.event.findUnique({ where: { id } });
  const current = await prisma.event.findUnique({ where: { id } });
  if (current?.status === to) return current;
  if (!current) return null;
  throw new EventLifecycleError();
}

export function openEvent(prisma: PrismaClient, id: string): Promise<Event | null> {
  return transitionEvent(prisma, id, 'DRAFT', 'OPEN');
}

export function closeEvent(prisma: PrismaClient, id: string): Promise<Event | null> {
  return transitionEvent(prisma, id, 'OPEN', 'CLOSED');
}
