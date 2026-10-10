import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type EmailDeliveryState, type PrismaClient } from '@prisma/client';
import { GmailDeliveryError } from '../mail/gmail-mailer';
import type { EmailMessage, EmailProvider } from '../mail/provider';

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
type OutboundContent = Omit<EmailMessage, 'to'>;
type DeliveryOptions = { batchId?: string; senderUserId?: string };
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

function safeError(error: unknown): { status: 'FAILED' | 'AMBIGUOUS'; message: string } {
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
  senderUserId?: string,
  onlyRecipient?: Recipient,
): Promise<DeliveryRow[]> {
  const payload = storePayload(message);
  const existing = await prisma.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
  if (existing.length > 0) {
    const awaitingConfirmationContent = kind === 'confirmation' && existing.every((row) =>
      row.eventId === eventId && row.kind === kind && row.status === 'PENDING' &&
      row.messagePayload === null && row.subject === 'Registration confirmation' && row.body === '',
    );
    if (awaitingConfirmationContent) {
      await prisma.emailLog.updateMany({
        where: { batchId, eventId, kind, status: 'PENDING', messagePayload: { equals: Prisma.DbNull } },
        data: { subject: message.subject, body: message.text, messagePayload: payload as Prisma.InputJsonObject },
      });
      return prisma.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
    }
    if (existing.some((row) => row.eventId !== eventId || row.subject !== message.subject || row.body !== message.text || row.kind !== kind || JSON.stringify(row.messagePayload ?? {}) !== JSON.stringify(payload))) {
      throw new EmailBatchConflictError();
    }
    return existing;
  }

  let recipients: Recipient[];
  if (onlyRecipient) {
    recipients = [{ email: onlyRecipient.email.trim().toLowerCase(), registrationId: onlyRecipient.registrationId }];
  } else {
    const registrations = await prisma.registration.findMany({
      where: { eventId, status: 'PAID' },
      select: { id: true, parentEmail: true },
      orderBy: [{ parentEmail: 'asc' }, { id: 'asc' }],
    });
    const unique = new Map<string, string>();
    for (const registration of registrations) {
      const email = registration.parentEmail.trim().toLowerCase();
      if (!unique.has(email)) unique.set(email, registration.id);
    }
    recipients = [...unique].map(([email, registrationId]) => ({ email, registrationId }));
  }

  await prisma.emailLog.createMany({
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
  return prisma.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
}

async function dispatchOne(
  deps: DeliveryDeps,
  row: DeliveryRow,
  now: Date,
  allowAmbiguous = false,
): Promise<void> {
  const retryable: EmailDeliveryState[] = allowAmbiguous
    ? ['PENDING', 'FAILED', 'AMBIGUOUS']
    : ['PENDING', 'FAILED'];
  const claim = await deps.prisma.emailLog.updateMany({
    where: { id: row.id, status: { in: retryable } },
    data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: now, failedAt: null, error: null },
  });
  if (claim.count !== 1) return;

  try {
    await deps.mailer.send(restoreMessage(row));
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
    try {
      await deps.prisma.emailLog.updateMany({
        where: { id: row.id, status: 'SENDING' },
        data: { status: 'AMBIGUOUS', failedAt: now, error: 'provider_accepted_log_update_failed' },
      });
    } catch {
      // A later stale-lease reconciliation marks an unresolved SENDING row ambiguous.
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
    where: { batchId, status: 'SENDING', lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: 'AMBIGUOUS', failedAt: now, error: 'delivery_interrupted_after_claim' },
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
  };
}

async function dispatchBatch(
  deps: DeliveryDeps,
  rows: DeliveryRow[],
  now: Date,
  allowAmbiguous = false,
): Promise<void> {
  await Promise.all(rows.map((row) => dispatchOne(deps, row, now, allowAmbiguous)));
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
  const rows = await prepareBatch(deps.prisma, eventId, message, kind, batchId, options.senderUserId, recipient);
  await dispatchBatch(deps, rows, now);
  return getDeliverySummary(deps.prisma, batchId);
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
  delivery: { eventId: string; registrationId: string; to: string; kind: string; batchId: string },
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
    { batchId: delivery.batchId },
  );
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
      status: { in: options.includeAmbiguous ? ['PENDING', 'FAILED', 'AMBIGUOUS'] : ['PENDING', 'FAILED'] },
    },
  });
  if (rows.length) await dispatchBatch(deps, rows, now, options.includeAmbiguous ?? false);
  return getDeliverySummary(deps.prisma, batchId);
}
