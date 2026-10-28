import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type EmailDeliveryState, type PrismaClient } from '@prisma/client';
import { GmailDeliveryError } from '../mail/gmail-mailer';
import type { EmailMessage, EmailProvider } from '../mail/provider';
import { INTERRUPTED_SEND, lockMailEvent, mailRegistrationEligibility } from '../mail/lifecycle';
import { isPastRetentionCutoff } from '../retention/service';

export type DeliverySummary = {
  batchId: string;
  sent: number;
  failed: number;
  ambiguous: number;
  pending: number;
  deliveryIds: string[];
  sentThisRun: number;
  failedThisRun: number;
  ambiguousThisRun: number;
};

export class EmailBatchConflictError extends Error {
  constructor() {
    super('Batch id was already used for a different message');
    this.name = 'EmailBatchConflictError';
  }
}

type DeliveryDeps = { prisma: PrismaClient; mailer: EmailProvider };
type OutboundContent = Omit<EmailMessage, 'to'>;
type DeliveryOptions = { batchId?: string; senderUserId?: string; maxAttempts?: number };
type DeliveryRow = Prisma.EmailLogGetPayload<{}>;
type Recipient = { email: string; registrationId: string | null };
type StoredPayload = {
  html?: string;
  attachments?: { filename: string; contentType: string; contentBase64: string }[];
  inlineImages?: { cid: string; filename: string; contentType: string; contentBase64: string }[];
};

export function deliveryIdempotencyKey(batchId: string, to: string): string {
  return createHash('sha256').update(`${batchId}\0${to.trim().toLowerCase()}`).digest('hex');
}

function storePayload(message: OutboundContent): StoredPayload {
  return {
    ...(message.html !== undefined ? { html: message.html } : {}),
    ...(message.attachments?.length ? {
      attachments: message.attachments.map((item) => ({
        filename: item.filename,
        contentType: item.contentType,
        contentBase64: Buffer.from(item.content).toString('base64'),
      })),
    } : {}),
    ...(message.inlineImages?.length ? {
      inlineImages: message.inlineImages.map((item) => ({
        cid: item.cid,
        filename: item.filename,
        contentType: item.contentType,
        contentBase64: Buffer.from(item.content).toString('base64'),
      })),
    } : {}),
  };
}

function restoreMessage(row: DeliveryRow): EmailMessage {
  const stored = (row.messagePayload ?? {}) as StoredPayload;
  return {
    to: row.to,
    subject: row.subject,
    text: row.body,
    ...(stored.html !== undefined ? { html: stored.html } : {}),
    ...(stored.attachments ? { attachments: stored.attachments.map((item) => ({
      filename: item.filename,
      contentType: item.contentType,
      content: Buffer.from(item.contentBase64, 'base64'),
    })) } : {}),
    ...(stored.inlineImages ? { inlineImages: stored.inlineImages.map((item) => ({
      cid: item.cid,
      filename: item.filename,
      contentType: item.contentType,
      content: Buffer.from(item.contentBase64, 'base64'),
    })) } : {}),
  };
}

/** Cron jobs stop retrying a delivery once it has been attempted this many times. */
export const AUTOMATIC_RETRY_LIMIT = 5;

function safeError(error: unknown): { status: 'FAILED' | 'AMBIGUOUS'; message: string } {
  // Failures before the send request (OAuth refresh, MIME composition) cannot
  // have delivered anything, so they are safe to retry automatically.
  if (error instanceof GmailDeliveryError && error.notSent) {
    return { status: 'FAILED', message: 'delivery_not_attempted' };
  }
  if (error instanceof GmailDeliveryError && error.status !== undefined && error.status < 500 && error.status !== 408) {
    return { status: 'FAILED', message: `provider_rejected_${error.status}` };
  }
  return { status: 'AMBIGUOUS', message: 'delivery_outcome_unknown' };
}

async function prepareBatch(
  prisma: PrismaClient,
  eventId: string,
  message: OutboundContent,
  kind: string,
  batchId: string,
  now: Date,
  senderUserId?: string,
  onlyRecipient?: Recipient,
): Promise<DeliveryRow[]> {
  const payload = storePayload(message);
  return prisma.$transaction(async (tx) => {
    const event = await lockMailEvent(tx, eventId);
    if (!event || isPastRetentionCutoff(event.eventDate, now)) return [];

    if (onlyRecipient) {
      const registration = onlyRecipient.registrationId && await tx.registration.findFirst({
        where: { id: onlyRecipient.registrationId, eventId, ...mailRegistrationEligibility(kind, now) },
      });
      if (!registration || !registration.parentEmail.trim()) return [];
    }
    const existing = await tx.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
    if (existing.length > 0) {
      const awaitingConfirmationContent = kind === 'confirmation' && existing.every((row) =>
        row.eventId === eventId && row.kind === kind && row.status === 'PENDING' &&
        row.messagePayload === null && row.subject === 'Registration confirmation' && row.body === '',
      );
      if (awaitingConfirmationContent) {
        await tx.emailLog.updateMany({
          where: { batchId, eventId, kind, status: 'PENDING', messagePayload: { equals: Prisma.DbNull } },
          data: { subject: message.subject, body: message.text, messagePayload: payload as Prisma.InputJsonObject },
        });
        return tx.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
      }
      if (existing.some((row) => row.eventId !== eventId || row.subject !== message.subject || row.body !== message.text || row.kind !== kind || JSON.stringify(row.messagePayload ?? {}) !== JSON.stringify(payload))) {
        throw new EmailBatchConflictError();
      }
      // Only reminders gain newly paid recipients; admin audiences stay frozen.
      if (kind !== 'reminder' || onlyRecipient) return existing;
    }

    let recipients: Recipient[];
    if (onlyRecipient) {
      recipients = [{ email: onlyRecipient.email.trim().toLowerCase(), registrationId: onlyRecipient.registrationId }];
    } else {
      const registrations = await tx.registration.findMany({
        where: { eventId, ...mailRegistrationEligibility(kind, now) },
        select: { id: true, parentEmail: true },
        orderBy: [{ parentEmail: 'asc' }, { id: 'asc' }],
      });
      const unique = new Map<string, string>();
      for (const registration of registrations) {
        const email = registration.parentEmail.trim().toLowerCase();
        if (email && !unique.has(email)) unique.set(email, registration.id);
      }
      recipients = [...unique].map(([email, registrationId]) => ({ email, registrationId }));
    }

    await tx.emailLog.createMany({
      skipDuplicates: true,
      data: recipients.map(({ email, registrationId }) => ({
        eventId,
        registrationId,
        senderUserId: senderUserId ?? null,
        batchId,
        idempotencyKey: deliveryIdempotencyKey(batchId, email),
        to: email,
        subject: message.subject,
        body: message.text,
        messagePayload: payload as Prisma.InputJsonObject,
        kind,
        status: 'PENDING',
      })),
    });
    return tx.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
  });
}

async function dispatchOne(
  deps: DeliveryDeps,
  row: DeliveryRow,
  now: Date,
  allowAmbiguous = false,
  maxAttempts?: number,
): Promise<'SENT' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED'> {
  const retryable: EmailDeliveryState[] = allowAmbiguous
    ? ['PENDING', 'FAILED', 'AMBIGUOUS']
    : ['PENDING', 'FAILED'];
  const claimed = await deps.prisma.$transaction(async (tx) => {
    const event = await lockMailEvent(tx, row.eventId);
    if (!event || isPastRetentionCutoff(event.eventDate, now)) return null;
    const current = await tx.emailLog.findFirst({
      where: {
        id: row.id,
        eventId: row.eventId,
        status: { in: retryable },
        ...(maxAttempts !== undefined ? { attempts: { lt: maxAttempts } } : {}),
      },
    });
    if (!current || !current.to || current.error === INTERRUPTED_SEND) return null;
    const eligible = current.kind === 'association'
      ? current.associationId ? await tx.memberAssociation.findFirst({
          where: { id: current.associationId, active: true, primaryContactEmail: { equals: current.to, mode: 'insensitive' } },
          select: { id: true },
        }) : null
      : await tx.registration.findFirst({
          where: {
            eventId: current.eventId,
            ...mailRegistrationEligibility(current.kind, now),
            OR: [
              { id: current.registrationId ?? '' },
              // A batch represents a household, not just the first paid sibling.
              ...(['message', 'reminder'].includes(current.kind)
                ? [{ parentEmail: { equals: current.to, mode: 'insensitive' as const } }]
                : []),
            ],
          },
          select: { id: true },
        });
    if (!eligible) return null;
    const claim = await tx.emailLog.updateMany({
      where: { id: current.id, status: { in: retryable } },
      data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: now, failedAt: null, error: null },
    });
    return claim.count === 1 ? current : null;
  });
  if (!claimed) return 'SKIPPED';
  const completion: Prisma.EmailLogWhereInput = {
    id: claimed.id, attempts: claimed.attempts + 1, lastAttemptAt: now,
    OR: [{ status: 'SENDING' }, { status: 'AMBIGUOUS', error: INTERRUPTED_SEND }],
  };

  try {
    await deps.mailer.send(restoreMessage(claimed));
  } catch (error) {
    const outcome = safeError(error);
    await deps.prisma.emailLog.updateMany({
      where: completion,
      data: { status: outcome.status, failedAt: now, error: outcome.message },
    });
    return outcome.status;
  }

  try {
    const markedSent = await deps.prisma.emailLog.updateMany({
      where: completion,
      data: { status: 'SENT', sentAt: now, failedAt: null, error: null },
    });
    if (markedSent.count !== 1) {
      await deps.prisma.emailLog.updateMany({
        where: completion,
        data: { status: 'AMBIGUOUS', failedAt: now, error: 'provider_accepted_log_update_failed' },
      });
      return 'AMBIGUOUS';
    }
    return 'SENT';
  } catch {
    try {
      await deps.prisma.emailLog.updateMany({
        where: completion,
        data: { status: 'AMBIGUOUS', failedAt: now, error: 'provider_accepted_log_update_failed' },
      });
    } catch {
      // A later stale-lease reconciliation marks an unresolved SENDING row ambiguous.
    }
    return 'AMBIGUOUS';
  }
}

export async function reconcileStaleDeliveries(prisma: PrismaClient, now: Date): Promise<number> {
  const result = await prisma.emailLog.updateMany({
    where: { status: 'SENDING', lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: 'AMBIGUOUS', failedAt: now, error: INTERRUPTED_SEND },
  });
  return result.count;
}

async function expireSendingLease(prisma: PrismaClient, batchId: string, now: Date): Promise<void> {
  await prisma.emailLog.updateMany({
    where: { batchId, status: 'SENDING', lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: 'AMBIGUOUS', failedAt: now, error: INTERRUPTED_SEND },
  });
}

export async function getDeliverySummary(prisma: PrismaClient, batchId: string): Promise<DeliverySummary> {
  const rows = await prisma.emailLog.findMany({ where: { batchId }, select: { id: true, status: true } });
  return {
    batchId,
    sent: rows.filter((row) => row.status === 'SENT').length,
    failed: rows.filter((row) => row.status === 'FAILED').length,
    ambiguous: rows.filter((row) => row.status === 'AMBIGUOUS').length,
    pending: rows.filter((row) => row.status === 'PENDING' || row.status === 'SENDING').length,
    deliveryIds: rows.map((row) => row.id),
    sentThisRun: 0,
    failedThisRun: 0,
    ambiguousThisRun: 0,
  };
}

async function dispatchBatch(
  deps: DeliveryDeps,
  rows: DeliveryRow[],
  now: Date,
  allowAmbiguous = false,
  maxAttempts?: number,
): Promise<Array<'SENT' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED'>> {
  // Bound both provider requests and transactions waiting on the per-event lock.
  const outcomes: Array<'SENT' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED'> = [];
  for (let start = 0; start < rows.length; start += 5) {
    outcomes.push(...await Promise.all(rows.slice(start, start + 5).map((row) => dispatchOne(deps, row, now, allowAmbiguous, maxAttempts))));
  }
  return outcomes;
}

function runCounts(results: Array<'SENT' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED'>) {
  return {
    sentThisRun: results.filter((result) => result === 'SENT').length,
    failedThisRun: results.filter((result) => result === 'FAILED').length,
    ambiguousThisRun: results.filter((result) => result === 'AMBIGUOUS').length,
  };
}

async function sendBatch(
  deps: DeliveryDeps,
  eventId: string,
  recipient: Recipient | undefined,
  message: OutboundContent,
  now: Date,
  kind: string,
  options: DeliveryOptions,
): Promise<DeliverySummary> {
  const batchId = options.batchId ?? randomUUID();
  await expireSendingLease(deps.prisma, batchId, now);
  const rows = await prepareBatch(deps.prisma, eventId, message, kind, batchId, now, options.senderUserId, recipient);
  const outcomes = await dispatchBatch(deps, rows, now, false, options.maxAttempts);
  return { ...await getDeliverySummary(deps.prisma, batchId), ...runCounts(outcomes) };
}

export async function dispatchSelectedRows(
  deps: DeliveryDeps,
  rows: DeliveryRow[],
  now: Date,
): Promise<DeliverySummary> {
  const batchId = rows[0]?.batchId ?? '';
  const outcomes = await dispatchBatch(deps, rows, now);
  return { ...await getDeliverySummary(deps.prisma, batchId), ...runCounts(outcomes) };
}

export async function deliverEventMessage(
  deps: DeliveryDeps,
  eventId: string,
  message: OutboundContent,
  now: Date,
  kind: string,
  options: DeliveryOptions = {},
): Promise<DeliverySummary> {
  return sendBatch(deps, eventId, undefined, message, now, kind, options);
}

export async function countEventMessageRecipients(prisma: PrismaClient, eventId: string): Promise<number> {
  const registrations = await prisma.registration.findMany({
    where: { eventId, status: 'PAID' },
    select: { parentEmail: true },
  });
  return new Set(registrations.map((registration) => registration.parentEmail.trim().toLowerCase())).size;
}

export async function sendEventMessage(
  deps: DeliveryDeps,
  eventId: string,
  message: OutboundContent,
  now: Date,
  options: DeliveryOptions = {},
): Promise<DeliverySummary> {
  return deliverEventMessage(deps, eventId, message, now, 'message', options);
}

export async function sendEmailToRecipient(
  deps: DeliveryDeps,
  delivery: { eventId: string; registrationId: string; to: string; kind: string; batchId: string; senderUserId?: string },
  message: OutboundContent,
  now: Date,
): Promise<DeliverySummary> {
  return sendBatch(
    deps,
    delivery.eventId,
    { email: delivery.to, registrationId: delivery.registrationId },
    message,
    now,
    delivery.kind,
    { batchId: delivery.batchId, senderUserId: delivery.senderUserId },
  );
}

export async function retryFailedDeliveries(
  deps: DeliveryDeps,
  eventId: string,
  batchId: string,
  deliveryIds: string[],
  now: Date,
  options: { includeAmbiguous?: boolean; maxAttempts?: number } = {},
): Promise<DeliverySummary> {
  await expireSendingLease(deps.prisma, batchId, now);
  const rows = await deps.prisma.emailLog.findMany({
    where: {
      eventId,
      batchId,
      id: { in: deliveryIds },
      status: { in: options.includeAmbiguous ? ['PENDING', 'FAILED', 'AMBIGUOUS'] : ['PENDING', 'FAILED'] },
    },
  });
  const outcomes = rows.length
    ? await dispatchBatch(deps, rows, now, options.includeAmbiguous ?? false, options.maxAttempts)
    : [];
  return { ...await getDeliverySummary(deps.prisma, batchId), ...runCounts(outcomes) };
}
