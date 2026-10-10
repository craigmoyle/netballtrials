import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { localDateTimeToUtc } from '../time/melbourne';
import { deliverEventMessage } from './service';

const DAY_MS = 24 * 60 * 60 * 1000;

export function eventStartInstant(eventDate: Date, startTime: string): Date {
  return localDateTimeToUtc(eventDate, startTime);
}

function eventDateBounds(now: Date): { gte: Date; lte: Date } {
  const startOfUtcDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    gte: new Date(startOfUtcDate - DAY_MS),
    lte: new Date(startOfUtcDate + 2 * DAY_MS),
  };
}

export async function sendDueReminders(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<{ sent: number; failed: number; ambiguous: number; events: number }> {
  const events = await deps.prisma.event.findMany({
    where: { eventDate: eventDateBounds(now) },
    select: { id: true, name: true, eventDate: true, venue: true, startTime: true },
  });
  let sent = 0;
  let failed = 0;
  let ambiguous = 0;
  let eventsDue = 0;

  for (const event of events) {
    const start = eventStartInstant(event.eventDate, event.startTime);
    const delta = start.getTime() - now.getTime();
    if (delta <= 0 || delta > DAY_MS) continue;

    const recipientCount = await deps.prisma.registration.count({ where: { eventId: event.id, status: 'PAID' } });
    if (recipientCount === 0) continue;
    eventsDue += 1;
    if (options.dryRun) continue;

    const batchId = `reminder:${event.id}:${event.eventDate.toISOString().slice(0, 10)}`;
    const result = await deliverEventMessage(
      deps,
      event.id,
      {
        subject: `Reminder: ${event.name}`,
        text: `${event.name} is at ${event.venue} on ${event.eventDate.toISOString().slice(0, 10)} at ${event.startTime}. See you there.`,
      },
      now,
      'reminder',
      { batchId },
    );
    sent += result.sentThisRun;
    failed += result.failedThisRun;
    ambiguous += result.ambiguousThisRun;
  }

  return { sent, failed, ambiguous, events: eventsDue };
}
