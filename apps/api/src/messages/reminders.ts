import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../env';
import type { EmailProvider } from '../mail/provider';
import type { PaymentProvider } from '../payments/provider';
import { INTERRUPTED_SEND, mailRegistrationEligibility } from '../mail/lifecycle';
import { localDateTimeToUtc } from '../time/melbourne';
import { AUTOMATIC_RETRY_LIMIT, EmailBatchConflictError, deliverEventMessage, reconcileStaleDeliveries, retryFailedDeliveries, sendEmailToRegistrationGroup } from './service';
import { isPastRetentionCutoff } from '../retention/service';
import { buildTrialCalendar } from '../registrations/calendar';
import { getAutomaticEmailSettings, renderAutomaticEmailSubject, renderAutomaticEmailTemplate } from './automatic-email-settings';
import { createRegistrationCheckout, recoverRegistrationCheckout } from '../registrations/checkout';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const EVENT_DETAILS_LEAD_HOURS = 24;
type ReminderDeps = {
  prisma: PrismaClient;
  mailer: EmailProvider;
  payment?: PaymentProvider;
  env?: Pick<Env, 'PAYMENT_PROVIDER' | 'WEB_ORIGIN' | 'MAIL_FROM'>;
};
type PaymentReminderEvent = { id: string; name: string; eventDate: Date; startTime: string };

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
  simulated: number;
  failed: number;
  ambiguous: number;
  events: number;
  errors: Array<{ eventId: string; message: string }>;
};

function registrationName(registration: { playerFirstName: string; playerLastName: string }): string {
  return `${registration.playerFirstName} ${registration.playerLastName}`.trim();
}

function paymentStageDue(delta: number, stage: '24h' | '1h'): boolean {
  const lead = (stage === '24h' ? 24 : 1) * HOUR_MS;
  return delta > 0 && delta <= lead && (stage === '1h' || delta > HOUR_MS);
}

function paymentStageKey(stage: '24h' | '1h', eventId: string, email: string, registrationIds: string[]): string {
  const household = createHash('sha256')
    .update(`${email.trim().toLowerCase()}\0${[...registrationIds].sort().join(',')}`)
    .digest('hex').slice(0, 16);
  return `payment-${stage}:${eventId}:${household}`;
}

async function retryPaymentReminderRows(deps: ReminderDeps, now: Date, result: ReminderRunResult): Promise<void> {
  const rows = await deps.prisma.emailLog.findMany({
    where: {
      kind: { in: ['payment-24h', 'payment-1h', 'payment-1h-warning', 'payment-1h-admin-warning'] },
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: AUTOMATIC_RETRY_LIMIT },
    },
    include: { event: { select: { eventDate: true, startTime: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const row of rows) {
    if (eventStartInstant(row.event.eventDate, row.event.startTime) <= now) {
      await deps.prisma.emailLog.updateMany({
        where: { id: row.id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'FAILED', failedAt: now, error: 'event_started' },
      });
      continue;
    }
    try {
      const delivery = await retryFailedDeliveries(deps, row.eventId, row.batchId, [row.id], now, { maxAttempts: AUTOMATIC_RETRY_LIMIT });
      result.sent += delivery.sentThisRun;
      result.simulated += delivery.simulatedThisRun;
      result.failed += delivery.failedThisRun;
      result.ambiguous += delivery.ambiguousThisRun;
    } catch {
      result.failed += 1;
      result.errors.push({ eventId: row.eventId, message: `payment_reminder_retry_failed:${row.id}` });
    }
  }
}

async function sendPaymentStage(
  deps: ReminderDeps,
  event: PaymentReminderEvent,
  now: Date,
  stage: '24h' | '1h',
  result: ReminderRunResult,
  dueEventIds: Set<string>,
): Promise<void> {
  if (!deps.payment || !deps.env) return;
  const registrations = await deps.prisma.registration.findMany({
    where: {
      eventId: event.id, anonymizedAt: null, ageFlagged: false, parentEmailVerifiedAt: { not: null },
      OR: [
        { status: 'PENDING', expiresAt: { gt: now } },
        { status: { in: ['EXPIRED', 'FAILED'] } },
      ],
    },
    orderBy: [{ parentEmail: 'asc' }, { id: 'asc' }],
  });
  const households = new Map<string, typeof registrations>();
  for (const registration of registrations) {
    const email = registration.parentEmail.trim().toLowerCase();
    if (email) households.set(email, [...(households.get(email) ?? []), registration]);
  }
  if (households.size) dueEventIds.add(event.id);

  for (const [email, household] of households) {
    const batchId = paymentStageKey(stage, event.id, email, household.map((registration) => registration.id));
    if (await deps.prisma.emailLog.findFirst({ where: { batchId }, select: { id: true } })) continue;
    const checkouts: Array<{ registration: (typeof household)[number]; url: string }> = [];
    const unavailable: typeof household = [];
    for (const registration of household) {
      const recovered = await recoverRegistrationCheckout(deps, registration.id, now);
      const checkout = recovered
        ? await createRegistrationCheckout({ ...deps, payment: deps.payment, env: deps.env }, recovered, now)
        : null;
      if (checkout && recovered) checkouts.push({ registration: recovered, url: checkout.url });
      else unavailable.push(registration);
    }
    if (!checkouts.length && stage === '24h') continue;

    const warning = stage === '1h' && unavailable.length > 0;
    const kind = warning ? 'payment-1h-warning' : `payment-${stage}`;
    const registrationList = warning ? household : checkouts.map((item) => item.registration);
    const validLinks = checkouts.map(({ registration, url }) => `${registrationName(registration)}: ${url}`).join('\n');
    const unavailableNames = unavailable.map(registrationName).join(', ');
    const details = warning
      ? `No payment has been received and the registration is incomplete. We could not prepare secure Checkout for ${unavailableNames}. Please contact the club immediately.${validLinks ? `\n\nCheckout is still available for the other registration(s):\n${validLinks}` : ''}`
      : `Registration is incomplete until payment is received. Complete the secure Checkout below:\n\n${validLinks}`;
    const message = {
      subject: warning ? `Payment warning: ${event.name}` : `Complete payment for ${event.name}`,
      text: `${details}\n\nEvent: ${event.name}\nStart: ${event.startTime}\n\nIf you have already paid, contact the club to check the payment record.`,
    };
    try {
      const delivery = await sendEmailToRegistrationGroup(deps, {
        eventId: event.id,
        registrationIds: registrationList.map((registration) => registration.id),
        to: email,
        kind,
        batchId,
      }, message, now);
      result.sent += delivery.sentThisRun;
      result.simulated += delivery.simulatedThisRun;
      result.failed += delivery.failedThisRun;
      result.ambiguous += delivery.ambiguousThisRun;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ eventId: event.id, message: error instanceof Error ? error.message : 'payment_reminder_failed' });
    }

    if (stage === '1h') {
      for (const registration of unavailable) {
        const adminBatchId = `${batchId}:admin:${registration.id}`;
        try {
          const delivery = await sendEmailToRegistrationGroup(deps, {
            eventId: event.id,
            registrationIds: [registration.id],
            to: deps.env.MAIL_FROM,
            kind: 'payment-1h-admin-warning',
            batchId: adminBatchId,
          }, {
            subject: `Admin payment warning: ${event.name}`,
            text: `Event: ${event.name}\nPlayer: ${registrationName(registration)}\nRegistration ID: ${registration.id}\nError category: checkout_unavailable\nNo payment has been received and the registration is incomplete. Contact the guardian immediately.`,
          }, now);
          result.sent += delivery.sentThisRun;
          result.simulated += delivery.simulatedThisRun;
          result.failed += delivery.failedThisRun;
          result.ambiguous += delivery.ambiguousThisRun;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ eventId: event.id, message: error instanceof Error ? error.message : 'admin_payment_warning_failed' });
        }
      }
    }
  }
}

async function markDryRunPaymentEvents(
  deps: ReminderDeps,
  events: PaymentReminderEvent[],
  now: Date,
  dueEventIds: Set<string>,
): Promise<void> {
  for (const event of events) {
    const delta = eventStartInstant(event.eventDate, event.startTime).getTime() - now.getTime();
    const due = paymentStageDue(delta, '24h') || paymentStageDue(delta, '1h');
    if (!due) continue;
    const pending = await deps.prisma.registration.count({
      where: {
        eventId: event.id, anonymizedAt: null, ageFlagged: false, parentEmailVerifiedAt: { not: null },
        OR: [
          { status: 'PENDING', expiresAt: { gt: now } },
          { status: { in: ['EXPIRED', 'FAILED'] } },
        ],
      },
    });
    if (pending) dueEventIds.add(event.id);
  }
}

async function sendDuePaymentReminders(
  deps: ReminderDeps,
  events: PaymentReminderEvent[],
  now: Date,
  result: ReminderRunResult,
  dueEventIds: Set<string>,
): Promise<void> {
  for (const event of events) {
    try {
      const delta = eventStartInstant(event.eventDate, event.startTime).getTime() - now.getTime();
      for (const stage of ['24h', '1h'] as const) {
        if (!paymentStageDue(delta, stage)) continue;
        await sendPaymentStage(deps, event, now, stage, result, dueEventIds);
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({ eventId: event.id, message: error instanceof Error ? error.message : 'payment_reminder_failed' });
    }
  }
}

export async function sendDueReminders(
  deps: ReminderDeps,
  now: Date,
  options: { dryRun?: boolean } = {},
): Promise<ReminderRunResult> {
  const settings = await getAutomaticEmailSettings(deps.prisma);
  const leadWindowMs = EVENT_DETAILS_LEAD_HOURS * HOUR_MS;
  const events = await deps.prisma.event.findMany({
    where: { eventDate: eventDateBounds(now, EVENT_DETAILS_LEAD_HOURS) },
    select: { id: true, name: true, eventDate: true, venue: true, startTime: true, endTime: true, gameStartTime: true, createdAt: true },
    orderBy: [{ eventDate: 'asc' }, { id: 'asc' }],
  });
  let sent = 0;
  let simulated = 0;
  let failed = 0;
  let ambiguous = 0;
  const dueEventIds = new Set<string>();
  const errors: ReminderRunResult['errors'] = [];
  const paymentResult: ReminderRunResult = { sent: 0, simulated: 0, failed: 0, ambiguous: 0, events: 0, errors: [] };

  if (!options.dryRun) await reconcileStaleDeliveries(deps.prisma, now);
  const emailChanges = (await deps.prisma.emailLog.findMany({
    where: {
      kind: 'email-change',
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: AUTOMATIC_RETRY_LIMIT },
    },
    include: { event: { select: { eventDate: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })).filter((row) => !isPastRetentionCutoff(row.event.eventDate, now));
  if (!options.dryRun) {
    const interrupted = await deps.prisma.emailLog.findMany({
      where: { kind: 'email-change', status: 'AMBIGUOUS', error: INTERRUPTED_SEND },
      select: { id: true, eventId: true, attempts: true },
    });
    for (const row of interrupted) {
      errors.push({ eventId: row.eventId, message: `email_change_notification_interrupted:${row.id}:attempt_${row.attempts}` });
    }
    for (const row of emailChanges) {
      try {
        const result = await retryFailedDeliveries(deps, row.eventId, row.batchId, [row.id], now, { maxAttempts: AUTOMATIC_RETRY_LIMIT });
        sent += result.sentThisRun;
        simulated += result.simulatedThisRun;
        failed += result.failedThisRun;
        ambiguous += result.ambiguousThisRun;
      } catch (error) {
        failed += 1;
        errors.push({ eventId: row.eventId, message: error instanceof Error ? error.message : 'unknown_error' });
      }
    }
  }

  if (!options.dryRun) {
    try {
      await retryPaymentReminderRows(deps, now, paymentResult);
      await sendDuePaymentReminders(deps, events, now, paymentResult, dueEventIds);
    } catch (error) {
      paymentResult.failed += 1;
      paymentResult.errors.push({ eventId: 'unknown', message: error instanceof Error ? error.message : 'payment_reminder_failed' });
    }
  } else {
    try {
      await markDryRunPaymentEvents(deps, events, now, dueEventIds);
    } catch (error) {
      paymentResult.failed += 1;
      paymentResult.errors.push({ eventId: 'unknown', message: error instanceof Error ? error.message : 'payment_reminder_failed' });
    }
  }

  for (const event of events) {
    const start = eventStartInstant(event.eventDate, event.startTime);
    const delta = start.getTime() - now.getTime();
    if (delta <= 0 || delta > leadWindowMs) continue;

    // One event's failure must not stop reminders for the others.
    try {
      const recipientCount = await deps.prisma.registration.count({ where: { eventId: event.id, status: 'PAID' } });
      if (recipientCount === 0) continue;
      dueEventIds.add(event.id);
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
      simulated += result.simulatedThisRun;
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

  return {
    sent: sent + paymentResult.sent,
    simulated: simulated + paymentResult.simulated,
    failed: failed + paymentResult.failed,
    ambiguous: ambiguous + paymentResult.ambiguous,
    events: dueEventIds.size,
    errors: [...errors, ...paymentResult.errors],
  };
}
