import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { CommunicationRecipientDTO, ScheduledMessageDTO } from '@netball-trials/types';
import { lockMailEvent, mailRegistrationEligibility } from '../mail/lifecycle';
import { isPastRetentionCutoff } from '../retention/service';
import { deliveryIdempotencyKey, dispatchSelectedRows, EmailBatchConflictError, type DeliverySummary } from './service';

export type CommunicationAudience = 'participants' | 'associations';
export type SelectedCommunication = { audience: CommunicationAudience; recipientIds: string[] };

function registrationsToRecipients(rows: Array<{
  id: string; playerFirstName: string; playerLastName: string; parentEmail: string; bibNumber: number | null;
  checkedInAt: Date | null; memberAssociation: string; status: string;
  rank1Position: string; rank2Position: string | null; rank3Position: string | null;
}>): CommunicationRecipientDTO[] {
  return rows.map((row) => ({
    id: row.id,
    name: `${row.playerFirstName} ${row.playerLastName}`.trim(),
    email: row.parentEmail,
    number: row.bibNumber,
    association: row.memberAssociation,
    registrationStatus: row.status as CommunicationRecipientDTO['registrationStatus'],
    checkedIn: row.checkedInAt !== null,
    positions: [row.rank1Position, row.rank2Position, row.rank3Position].filter(Boolean) as CommunicationRecipientDTO['positions'],
  }));
}

export async function listCommunicationRecipients(prisma: PrismaClient, eventId: string): Promise<{
  participants: CommunicationRecipientDTO[];
  associations: CommunicationRecipientDTO[];
} | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return null;
  const [registrations, associations] = await Promise.all([
    prisma.registration.findMany({
      where: { eventId, anonymizedAt: null },
      select: {
        id: true, playerFirstName: true, playerLastName: true, parentEmail: true, bibNumber: true,
        checkedInAt: true, memberAssociation: true, status: true, rank1Position: true,
        rank2Position: true, rank3Position: true,
      },
      orderBy: [{ playerLastName: 'asc' }, { playerFirstName: 'asc' }],
    }),
    prisma.memberAssociation.findMany({
      where: { active: true, primaryContactEmail: { not: null } },
      select: { id: true, name: true, primaryContactName: true, primaryContactEmail: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    participants: registrationsToRecipients(registrations),
    associations: associations.filter((item) => item.primaryContactEmail).map((item) => ({
      id: item.id,
      name: item.primaryContactName ? `${item.name} — ${item.primaryContactName}` : item.name,
      email: item.primaryContactEmail!,
      number: null,
      association: item.name,
      registrationStatus: null,
      checkedIn: null,
      positions: [],
    })),
  };
}

async function createSelectedRows(
  prisma: PrismaClient,
  eventId: string,
  selected: SelectedCommunication,
  subject: string,
  body: string,
  batchId: string,
  now: Date,
  senderUserId?: string,
  policyAttachment?: { fileName: string; contentBase64: string } | null,
): Promise<Prisma.EmailLogGetPayload<{}>[]> {
  return prisma.$transaction(async (tx) => {
    const event = await lockMailEvent(tx, eventId);
    if (!event || isPastRetentionCutoff(event.eventDate, now)) return [];
    const kind = selected.audience === 'associations' ? 'association' : 'message';
    const messagePayload = policyAttachment ? { attachments: [{ filename: policyAttachment.fileName, contentType: 'application/pdf', contentBase64: policyAttachment.contentBase64 }] } : null;
    const existing = await tx.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
    if (existing.length) {
      if (existing.some((row) => row.eventId !== eventId || row.subject !== subject || row.body !== body || row.kind !== kind || JSON.stringify(row.messagePayload ?? null) !== JSON.stringify(messagePayload))) {
        throw new EmailBatchConflictError();
      }
      return existing;
    }

    const recipientIds = [...new Set(selected.recipientIds)];
    if (recipientIds.length === 0) return [];
    const targets: Array<{ to: string; registrationId: string | null; associationId: string | null }> = [];
    if (selected.audience === 'participants') {
      const registrations = await tx.registration.findMany({
        where: { eventId, id: { in: recipientIds }, ...mailRegistrationEligibility('message', now) },
        select: { id: true, parentEmail: true },
        orderBy: [{ parentEmail: 'asc' }, { id: 'asc' }],
      });
      const byEmail = new Map<string, string>();
      for (const registration of registrations) {
        const email = registration.parentEmail.trim().toLowerCase();
        if (email && !byEmail.has(email)) byEmail.set(email, registration.id);
      }
      for (const [to, registrationId] of byEmail) targets.push({ to, registrationId, associationId: null });
    } else {
      const associations = await tx.memberAssociation.findMany({
        where: { id: { in: recipientIds }, active: true, primaryContactEmail: { not: null } },
        select: { id: true, primaryContactEmail: true },
        orderBy: { name: 'asc' },
      });
      const byEmail = new Map<string, string>();
      for (const association of associations) {
        const email = association.primaryContactEmail?.trim().toLowerCase();
        if (email && !byEmail.has(email)) byEmail.set(email, association.id);
      }
      for (const [to, associationId] of byEmail) targets.push({ to, registrationId: null, associationId });
    }

    await tx.emailLog.createMany({
      skipDuplicates: true,
      data: targets.map((target) => ({
        eventId, registrationId: target.registrationId, associationId: target.associationId,
        senderUserId: senderUserId ?? null, batchId,
        idempotencyKey: deliveryIdempotencyKey(batchId, target.to),
        to: target.to, subject, body, kind, status: 'PENDING',
        messagePayload: messagePayload ? messagePayload as Prisma.InputJsonObject : Prisma.DbNull,
      })),
    });
    return tx.emailLog.findMany({ where: { batchId }, orderBy: { to: 'asc' } });
  });
}

export async function previewSelectedRecipients(
  prisma: PrismaClient,
  eventId: string,
  selected: SelectedCommunication,
): Promise<CommunicationRecipientDTO[] | null> {
  const available = await listCommunicationRecipients(prisma, eventId);
  if (!available) return null;
  const requested = new Set(selected.recipientIds);
  const candidates = selected.audience === 'participants' ? available.participants : available.associations;
  const eligible = candidates.filter((recipient) => requested.has(recipient.id) &&
    (selected.audience === 'associations' || recipient.registrationStatus === 'PAID') && recipient.email.trim());
  const seen = new Set<string>();
  return eligible.filter((recipient) => {
    const email = recipient.email.trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

export async function sendSelectedCommunication(
  deps: { prisma: PrismaClient; mailer: import('../mail/provider').EmailProvider },
  eventId: string,
  selected: SelectedCommunication,
  message: { subject: string; text: string },
  now: Date,
  options: { batchId?: string; senderUserId?: string; policyAttachment?: { fileName: string; contentBase64: string } | null } = {},
): Promise<DeliverySummary> {
  const batchId = options.batchId ?? randomUUID();
  const policyAttachment = options.policyAttachment === undefined
    ? await deps.prisma.eventPolicyDocument.findUnique({ where: { eventId }, select: { fileName: true, bytes: true } }).then((document) => document ? { fileName: document.fileName, contentBase64: Buffer.from(document.bytes).toString('base64') } : null)
    : options.policyAttachment;
  const rows = await createSelectedRows(deps.prisma, eventId, selected, message.subject, message.text, batchId, now, options.senderUserId, policyAttachment);
  return dispatchSelectedRows(deps, rows, now);
}

export async function getScheduledMessages(prisma: PrismaClient, eventId: string): Promise<ScheduledMessageDTO[]> {
  const rows = await prisma.scheduledMessage.findMany({ where: { eventId }, orderBy: { scheduledAt: 'desc' } });
  return rows.map((row) => ({
    id: row.id, eventId: row.eventId, audience: row.audience as CommunicationAudience,
    recipientIds: row.recipientIds as string[], batchId: row.batchId, subject: row.subject, body: row.body,
    scheduledAt: row.scheduledAt.toISOString(), status: row.status, attempts: row.attempts, error: row.error,
  }));
}

export async function runDueScheduledMessages(
  deps: { prisma: PrismaClient; mailer: import('../mail/provider').EmailProvider },
  now: Date,
): Promise<{ completed: number; failed: number }> {
  const due = await deps.prisma.scheduledMessage.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'asc' }, take: 20,
  });
  let completed = 0;
  let failed = 0;
  for (const scheduled of due) {
    const claim = await deps.prisma.scheduledMessage.updateMany({
      where: { id: scheduled.id, status: 'SCHEDULED' },
      data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: now, error: null },
    });
    if (claim.count !== 1) continue;
    try {
      const result = await sendSelectedCommunication(deps, scheduled.eventId, {
        audience: scheduled.audience as CommunicationAudience,
        recipientIds: scheduled.recipientIds as string[],
      }, { subject: scheduled.subject, text: scheduled.body }, now, {
        batchId: scheduled.batchId, senderUserId: scheduled.senderUserId ?? undefined,
        policyAttachment: scheduled.policyAttachment as { fileName: string; contentBase64: string } | null,
      });
      const done = result.deliveryIds.length > 0 && result.failed === 0 && result.ambiguous === 0 && result.pending === 0;
      await deps.prisma.scheduledMessage.updateMany({
        where: { id: scheduled.id, status: 'SENDING', attempts: scheduled.attempts + 1 },
        data: { status: done ? 'COMPLETED' : 'FAILED', completedAt: done ? now : null,
          error: done ? null : `delivery_${result.failed}_failed_${result.ambiguous}_unknown_${result.pending}_pending` },
      });
      if (done) completed += 1;
      else failed += 1;
    } catch (error) {
      await deps.prisma.scheduledMessage.updateMany({
        where: { id: scheduled.id, status: 'SENDING', attempts: scheduled.attempts + 1 },
        data: { status: 'FAILED', error: error instanceof Error ? 'scheduled_send_failed' : 'scheduled_send_failed' },
      });
      failed += 1;
    }
  }
  return { completed, failed };
}
