import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { localDateTimeToUtc } from '../time/melbourne';
import { deliverEventMessage } from './service';

const DAY_MS = 24 * 60 * 60 * 1000;

export function eventStartInstant(eventDate: Date, firstWhistle: string): Date {
  return localDateTimeToUtc(eventDate, firstWhistle);
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
