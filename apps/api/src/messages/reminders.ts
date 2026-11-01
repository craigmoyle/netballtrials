import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { mailRegistrationEligibility } from '../mail/lifecycle';
import { localDateTimeToUtc } from '../time/melbourne';
import { AUTOMATIC_RETRY_LIMIT, EmailBatchConflictError, deliverEventMessage } from './service';
import { buildTrialCalendar } from '../registrations/calendar';
import { getAutomaticEmailSettings, renderAutomaticEmailSubject, renderAutomaticEmailTemplate } from './automatic-email-settings';

const DAY_MS = 24 * 60 * 60 * 1000;

export function eventStartInstant(eventDate: Date, startTime: string): Date {
  return localDateTimeToUtc(eventDate, startTime);
}

function eventDateBounds(now: Date, leadHours: number): { gte: Date; lte: Date } {
  const startOfUtcDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const horizonDays = Math.ceil(leadHours / 24) + 2;
  return {
    gte: new Date(startOfUtcDate - DAY_MS),
    lte: new Date(startOfUtcDate + horizonDays * DAY_MS),
  };
}

export type ReminderRunResult = {
  sent: number;
  failed: number;
  ambiguous: number;
  events: number;
  errors: Array<{ eventId: string; message: string }>;
};

export async function sendDueReminders(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<ReminderRunResult> {
  const settings = await getAutomaticEmailSettings(deps.prisma);
  const leadWindowMs = settings.reminderLeadHours * 60 * 60 * 1000;
  const events = await deps.prisma.event.findMany({
    where: { eventDate: eventDateBounds(now, settings.reminderLeadHours) },
    select: { id: true, name: true, eventDate: true, venue: true, startTime: true, endTime: true, gameStartTime: true, createdAt: true },
    orderBy: [{ eventDate: 'asc' }, { id: 'asc' }],
  });
  let sent = 0;
  let failed = 0;
  let ambiguous = 0;
  let eventsDue = 0;
  const errors: ReminderRunResult['errors'] = [];

  for (const event of events) {
    const start = eventStartInstant(event.eventDate, event.startTime);
    const delta = start.getTime() - now.getTime();
    if (delta <= 0 || delta > leadWindowMs) continue;

    // One event's failure must not stop reminders for the others.
    try {
      const recipientCount = await deps.prisma.registration.count({ where: { eventId: event.id, status: 'PAID' } });
      if (recipientCount === 0) continue;
      eventsDue += 1;
      if (options.dryRun) continue;

      const batchId = `reminder:${event.id}:${event.eventDate.toISOString().slice(0, 10)}`;
      const result = await deliverEventMessage(
        deps,
        event.id,
        {
          subject: renderAutomaticEmailSubject(settings.reminderSubject, { eventName: event.name }),
          text: renderAutomaticEmailTemplate(settings.reminderBody, {
            eventName: event.name,
            venue: event.venue,
            eventDate: event.eventDate.toISOString().slice(0, 10),
            startTime: event.startTime,
          }),
          attachments: [{
            filename: `${event.id}.ics`,
            contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
            content: Buffer.from(buildTrialCalendar(event, `${event.id}@chisholmnetball.com`, event.createdAt), 'utf8'),
          }],
        },
        now,
        { kind: 'reminder', batchId, maxAttempts: AUTOMATIC_RETRY_LIMIT },
      );
      sent += result.sentThisRun;
      failed += result.failedThisRun;
      ambiguous += result.ambiguousThisRun;
    } catch (error) {
      // Content stays immutable; report both unsent rows and households that top-up could not add.
      if (error instanceof EmailBatchConflictError) {
        const batchId = `reminder:${event.id}:${event.eventDate.toISOString().slice(0, 10)}`;
        const existing = await deps.prisma.emailLog.findMany({ where: { eventId: event.id, batchId }, select: { to: true, status: true } });
        const unsent = existing.filter((row) => ['PENDING', 'FAILED', 'AMBIGUOUS'].includes(row.status)).length;
        if (unsent > 0) errors.push({ eventId: event.id, message: `reminder_changed_with_${unsent}_unsent` });
        const registrations = await deps.prisma.registration.findMany({
          where: { eventId: event.id, ...mailRegistrationEligibility('reminder', now) },
          select: { id: true, parentEmail: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const represented = new Set(existing.map((row) => row.to.trim().toLowerCase()));
        const omitted: string[] = [];
        for (const registration of registrations) {
          const email = registration.parentEmail.trim().toLowerCase();
          if (!email || represented.has(email)) continue;
          represented.add(email);
          omitted.push(registration.id);
        }
        if (omitted.length > 0) errors.push({
          eventId: event.id,
          message: `reminder_changed_with_${omitted.length}_omitted: Send an updated message manually to the paid households for registrations ${omitted.join(', ')}. The existing reminder was not changed or resent.`,
        });
        continue;
      }
      failed += 1;
      errors.push({ eventId: event.id, message: error instanceof Error ? error.message : 'unknown_error' });
    }
  }

  return { sent, failed, ambiguous, events: eventsDue, errors };
}
