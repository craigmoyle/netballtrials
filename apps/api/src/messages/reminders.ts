import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { deliverEventMessage } from './service';

const MELBOURNE = 'Australia/Melbourne';
const DAY_MS = 24 * 60 * 60 * 1000;

function zoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

export function eventStartInstant(eventDate: Date, firstWhistle: string, timeZone = MELBOURNE): Date {
  const datePart = eventDate.toISOString().slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = firstWhistle.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

export async function sendDueReminders(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  now: Date,
): Promise<{ sent: number; failed: number; events: number }> {
  const events = await deps.prisma.event.findMany();
  let sent = 0;
  let failed = 0;
  let eventsDue = 0;

  for (const event of events) {
    const start = eventStartInstant(event.eventDate, event.firstWhistle);
    const delta = start.getTime() - now.getTime();
    if (delta <= 0 || delta > DAY_MS) {
      continue;
    }

    const alreadyLogged = await deps.prisma.emailLog.count({
      where: { eventId: event.id, kind: 'reminder' },
    });
    if (alreadyLogged > 0) {
      continue;
    }

    eventsDue += 1;
    const result = await deliverEventMessage(
      deps,
      event.id,
      {
        subject: `Reminder: ${event.name} is on tomorrow`,
        text: `${event.name} starts at ${event.firstWhistle} at ${event.venue}. See you there.`,
      },
      now,
      'reminder',
    );
    sent += result.sent;
    failed += result.failed;
  }

  return { sent, failed, events: eventsDue };
}
