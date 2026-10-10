import { createHash, randomUUID } from 'node:crypto';
import type { EmailDeliveryState, Prisma, PrismaClient } from '@prisma/client';
import { GmailDeliveryError } from '../mail/gmail-mailer';
import type { EmailProvider } from '../mail/provider';

export type DeliverySummary = {
  batchId: string;
  sent: number;
  failed: number;
  ambiguous: number;
  pending: number;
  deliveryIds: string[];
};

export class EmailBatchConflictError extends Error {
  constructor() {
    super('Batch id was already used for a different message');
    this.name = 'EmailBatchConflictError';
  }
}

type DeliveryDeps = { prisma: PrismaClient; mailer: EmailProvider };
type MessageBody = { subject: string; text: string; html?: string };
type DeliveryOptions = { batchId?: string; senderUserId?: string };
type DeliveryRow = Prisma.EmailLogGetPayload<{}>;

function idempotencyKey(batchId: string, to: string): string {
  return createHash('sha256').update(`${batchId}\0${to.trim().toLowerCase()}`).digest('hex');
}

function safeError(error: unknown): { status: 'FAILED' | 'AMBIGUOUS'; message: string } {
  if (error instanceof GmailDeliveryError && error.status !== undefined && error.status < 500 && error.status !== 408) {
    return { status: 'FAILED', message: `provider_rejected_${error.status}` };
  }
  return { status: 'AMBIGUOUS', message: 'delivery_outcome_unknown' };
}

async function prepareBatch(
  prisma: PrismaClient,
  eventId: string,
  message: MessageBody,
  kind: string,
  batchId: string,
  senderUserId?: string,
): Promise<DeliveryRow[]> {
  const existing = await prisma.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
  if (existing.length > 0) {
    if (existing.some((row) => row.eventId !== eventId || row.subject !== message.subject || row.body !== message.text || row.kind !== kind)) {
      throw new EmailBatchConflictError();
    }
    return existing;
  }

  const registrations = await prisma.registration.findMany({
    where: { eventId, status: 'PAID' },
    select: { id: true, parentEmail: true },
    orderBy: [{ parentEmail: 'asc' }, { id: 'asc' }],
  });
  const recipients = new Map<string, string>();
  for (const registration of registrations) {
    const to = registration.parentEmail.trim().toLowerCase();
    if (!recipients.has(to)) recipients.set(to, registration.id);
  }

  await prisma.emailLog.createMany({
    skipDuplicates: true,
    data: [...recipients].map(([to, registrationId]) => ({
      eventId,
      registrationId,
      senderUserId: senderUserId ?? null,
      batchId,
      idempotencyKey: idempotencyKey(batchId, to),
      to,
      subject: message.subject,
      body: message.text,
      kind,
      status: 'PENDING',
    })),
  });
  return prisma.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
}

async function dispatchOne(
  deps: DeliveryDeps,
  row: DeliveryRow,
  message: MessageBody,
  now: Date,
  allowAmbiguous = false,
): Promise<void> {
  const retryable: EmailDeliveryState[] = allowAmbiguous
    ? ['PENDING', 'FAILED', 'AMBIGUOUS']
    : ['PENDING', 'FAILED'];
  const claim = await deps.prisma.emailLog.updateMany({
    where: { id: row.id, status: { in: retryable } },
    data: {
      status: 'SENDING',
      attempts: { increment: 1 },
      lastAttemptAt: now,
      failedAt: null,
      error: null,
    },
  });
  if (claim.count !== 1) return;

  try {
    await deps.mailer.send({ to: row.to, subject: row.subject, text: message.text, html: message.html });
  } catch (error) {
    const outcome = safeError(error);
    await deps.prisma.emailLog.updateMany({
      where: { id: row.id, status: 'SENDING' },
      data: { status: outcome.status, failedAt: now, error: outcome.message },
    });
    return;
  }

  try {
    const markedSent = await deps.prisma.emailLog.updateMany({
      where: { id: row.id, status: 'SENDING' },
      data: { status: 'SENT', sentAt: now, failedAt: null, error: null },
    });
    if (markedSent.count !== 1) {
      await deps.prisma.emailLog.updateMany({
        where: { id: row.id, status: 'SENDING' },
        data: { status: 'AMBIGUOUS', failedAt: now, error: 'provider_accepted_log_update_failed' },
      });
    }
  } catch {
    // Gmail accepted the request, but durable success could not be recorded.
    // Leave a safe ambiguity marker when the database becomes reachable again.
    try {
      await deps.prisma.emailLog.updateMany({
        where: { id: row.id, status: 'SENDING' },
        data: { status: 'AMBIGUOUS', failedAt: now, error: 'provider_accepted_log_update_failed' },
      });
    } catch {
      // The SENDING lease is aged into AMBIGUOUS before any later dispatch.
    }
  }
}

export async function reconcileStaleDeliveries(prisma: PrismaClient, now: Date): Promise<number> {
  const result = await prisma.emailLog.updateMany({
    where: { status: 'SENDING', lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: 'AMBIGUOUS', failedAt: now, error: 'delivery_interrupted_after_claim' },
  });
  return result.count;
}

async function expireSendingLease(prisma: PrismaClient, batchId: string, now: Date): Promise<void> {
  await prisma.emailLog.updateMany({
    where: {
      batchId,
      status: 'SENDING',
      lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) },
    },
    data: { status: 'AMBIGUOUS', failedAt: now, error: 'delivery_interrupted_after_claim' },
  });
}

async function summarize(prisma: PrismaClient, batchId: string): Promise<DeliverySummary> {
  const rows = await prisma.emailLog.findMany({ where: { batchId }, select: { id: true, status: true } });
  return {
    batchId,
    sent: rows.filter((row) => row.status === 'SENT').length,
    failed: rows.filter((row) => row.status === 'FAILED').length,
    ambiguous: rows.filter((row) => row.status === 'AMBIGUOUS').length,
    pending: rows.filter((row) => row.status === 'PENDING' || row.status === 'SENDING').length,
    deliveryIds: rows.map((row) => row.id),
  };
}

async function dispatchBatch(
  deps: DeliveryDeps,
  rows: DeliveryRow[],
  message: MessageBody,
  now: Date,
  allowAmbiguous = false,
): Promise<void> {
  await Promise.all(rows.map((row) => dispatchOne(deps, row, message, now, allowAmbiguous)));
}

export async function deliverEventMessage(
  deps: DeliveryDeps,
  eventId: string,
  message: MessageBody,
  now: Date,
  kind: string,
  options: DeliveryOptions = {},
): Promise<DeliverySummary> {
  const batchId = options.batchId ?? randomUUID();
  await expireSendingLease(deps.prisma, batchId, now);
  const rows = await prepareBatch(deps.prisma, eventId, message, kind, batchId, options.senderUserId);
  await dispatchBatch(deps, rows, message, now);
  return summarize(deps.prisma, batchId);
}

export async function sendEventMessage(
  deps: DeliveryDeps,
  eventId: string,
  message: MessageBody,
  now: Date,
  options: DeliveryOptions = {},
): Promise<DeliverySummary> {
  return deliverEventMessage(deps, eventId, message, now, 'message', options);
}

export async function retryFailedDeliveries(
  deps: DeliveryDeps,
  eventId: string,
  batchId: string,
  deliveryIds: string[],
  now: Date,
  options: { includeAmbiguous?: boolean } = {},
): Promise<DeliverySummary> {
  await expireSendingLease(deps.prisma, batchId, now);
  const rows = await deps.prisma.emailLog.findMany({
    where: {
      eventId,
      batchId,
      id: { in: deliveryIds },
      status: { in: options.includeAmbiguous ? ['FAILED', 'AMBIGUOUS'] : ['FAILED'] },
    },
  });
  if (rows.length) {
    await dispatchBatch(deps, rows, { subject: rows[0].subject, text: rows[0].body }, now, options.includeAmbiguous ?? false);
  }
  return summarize(deps.prisma, batchId);
}
