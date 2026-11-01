import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { CommunicationRecipientDTO, SiteAssociationCampaignDTO } from '@netball-trials/types';
import type { EmailProvider } from '../mail/provider';
import { lockMailEvent } from '../mail/lifecycle';
import { isPastRetentionCutoff } from '../retention/service';
import { deliveryIdempotencyKey, dispatchSelectedRows, EmailBatchConflictError, retryFailedDeliveries, type DeliverySummary } from './service';
import { renderEmailTemplate } from './template-renderer';

export type SiteAssociationCommunicationInput = {
  eventIds: string[];
  associationIds: string[];
  subject: string;
  text: string;
  scheduledAt?: Date;
  senderUserId?: string;
  batchId?: string;
};

type SiteEvent = {
  id: string;
  name: string;
  division: string;
  section: string;
  eventDate: Date;
  venue: string;
  startTime: string;
  gameStartTime: string;
};

type SiteAssociation = { id: string; name: string; primaryContactName: string | null; primaryContactEmail: string | null };

function selectedIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function matchesCampaignInput(
  campaign: { eventIds: Prisma.JsonValue; recipientIds: Prisma.JsonValue; subject: string; body: string; scheduledAt: Date | null },
  eventIds: string[],
  associationIds: string[],
  input: SiteAssociationCommunicationInput,
): boolean {
  return JSON.stringify(campaign.eventIds) === JSON.stringify(eventIds) &&
    JSON.stringify(campaign.recipientIds) === JSON.stringify(associationIds) &&
    campaign.subject === input.subject && campaign.body === input.text &&
    campaign.scheduledAt?.getTime() === input.scheduledAt?.getTime();
}

function formatEventDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatEventList(events: SiteEvent[]): string {
  return events.map((event) => {
    const group = [event.division, event.section].filter(Boolean).join(' ');
    return `• ${event.name}${group ? ` (${group})` : ''} — ${formatEventDate(event.eventDate)} at ${event.startTime}, ${event.venue}`;
  }).join('\n');
}

function eventTemplateFields(events: SiteEvent[]): Record<string, string> {
  const one = events.length === 1 ? events[0] : null;
  return {
    eventList: formatEventList(events),
    eventName: one?.name ?? events.map((event) => event.name).join(', '),
    eventDate: one ? formatEventDate(one.eventDate) : '',
    arrivalTime: one?.startTime ?? '',
    startTime: one?.gameStartTime ?? '',
    venue: one?.venue ?? '',
  };
}

async function getSiteContext(
  prisma: PrismaClient,
  eventIds: string[],
  associationIds: string[],
  now: Date,
): Promise<{ events: SiteEvent[]; anchorEventId: string; associations: SiteAssociation[] } | null> {
  const uniqueEventIds = selectedIds(eventIds);
  const uniqueAssociationIds = selectedIds(associationIds);
  if (!uniqueEventIds.length || !uniqueAssociationIds.length) return null;

  const events = await prisma.event.findMany({
    where: { id: { in: uniqueEventIds } },
    select: { id: true, name: true, division: true, section: true, eventDate: true, venue: true, startTime: true, gameStartTime: true },
  });
  if (events.length !== uniqueEventIds.length || events.some((event) => isPastRetentionCutoff(event.eventDate, now))) return null;
  const orderedEvents = uniqueEventIds.map((id) => events.find((event) => event.id === id)!).filter(Boolean);
  const anchor = [...events].sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime() || a.id.localeCompare(b.id))[0];
  const associations = await prisma.memberAssociation.findMany({
    where: { id: { in: uniqueAssociationIds }, active: true, primaryContactEmail: { not: null } },
    select: { id: true, name: true, primaryContactName: true, primaryContactEmail: true },
    orderBy: { name: 'asc' },
  });
  if (associations.length !== uniqueAssociationIds.length || !uniqueAssociationEmails(associations).length) return null;
  return { events: orderedEvents, anchorEventId: anchor.id, associations };
}

function uniqueAssociationEmails(associations: SiteAssociation[]): SiteAssociation[] {
  const seen = new Set<string>();
  return associations.filter((association) => {
    const email = association.primaryContactEmail?.trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

export async function previewSiteAssociationCommunication(
  prisma: PrismaClient,
  input: Pick<SiteAssociationCommunicationInput, 'eventIds' | 'associationIds' | 'subject' | 'text'>,
  now: Date,
): Promise<{ events: SiteEvent[]; recipients: CommunicationRecipientDTO[]; subject: string; text: string } | null> {
  const context = await getSiteContext(prisma, input.eventIds, input.associationIds, now);
  if (!context) return null;
  const targetAssociations = uniqueAssociationEmails(context.associations);
  const recipients = targetAssociations.map((association): CommunicationRecipientDTO => ({
    id: association.id,
    name: association.primaryContactName ? `${association.name} — ${association.primaryContactName}` : association.name,
    email: association.primaryContactEmail!.trim(),
    number: null,
    association: association.name,
    registrationStatus: null,
    checkedIn: null,
    positions: [],
  }));
  const fields = eventTemplateFields(context.events);
  const sample = targetAssociations[0];
  return {
    events: context.events,
    recipients,
    subject: renderEmailTemplate(input.subject, { ...fields, associationName: sample.name, contactName: sample.primaryContactName ?? '' }),
    text: renderEmailTemplate(input.text, { ...fields, associationName: sample.name, contactName: sample.primaryContactName ?? '' }),
  };
}

export async function createSiteAssociationCommunication(
  deps: { prisma: PrismaClient; mailer: EmailProvider },
  input: SiteAssociationCommunicationInput,
  now: Date,
): Promise<SiteAssociationCampaignDTO | null> {
  const { prisma, mailer } = deps;
  const eventIds = selectedIds(input.eventIds);
  const associationIds = selectedIds(input.associationIds);
  if (!eventIds.length || !associationIds.length) return null;

  const context = await getSiteContext(prisma, eventIds, associationIds, now);
  if (!context) return null;
  const batchId = `site-associations:${input.batchId ?? randomUUID()}`;
  const existing = await prisma.siteAssociationCommunication.findUnique({ where: { batchId } });
  if (existing) {
    if (!matchesCampaignInput(existing, eventIds, associationIds, input)) throw new EmailBatchConflictError();
    return listSiteAssociationCommunications(prisma).then((rows) => rows.find((item) => item.id === existing.id) ?? null);
  }
  const status = input.scheduledAt ? 'SCHEDULED' : 'SENDING';
  const row = await prisma.siteAssociationCommunication.create({
    data: {
      anchorEventId: context.anchorEventId,
      eventIds: eventIds as Prisma.InputJsonArray,
      recipientIds: associationIds as Prisma.InputJsonArray,
      senderUserId: input.senderUserId ?? null,
      batchId,
      subject: input.subject,
      body: input.text,
      scheduledAt: input.scheduledAt ?? null,
      status,
      attempts: input.scheduledAt ? 0 : 1,
      lastAttemptAt: input.scheduledAt ? null : now,
    },
  }).catch(async (error: unknown) => {
    const duplicate = await prisma.siteAssociationCommunication.findUnique({ where: { batchId } });
    if (!duplicate) throw error;
    if (!matchesCampaignInput(duplicate, eventIds, associationIds, input)) throw new EmailBatchConflictError();
    return null;
  });
  if (!row) return listSiteAssociationCommunications(prisma).then((rows) => rows.find((item) => item.batchId === batchId) ?? null);
  if (input.scheduledAt) return toCampaignDTO(row, [], context.events);
  return dispatchSiteAssociationCommunication(prisma, { mailer }, row.id, now);
}

async function createSiteDeliveryRows(
  prisma: PrismaClient,
  campaignId: string,
  now: Date,
): Promise<{ anchorEventId: string; rows: Prisma.EmailLogGetPayload<{}>[] } | null> {
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.siteAssociationCommunication.findUnique({ where: { id: campaignId } });
    if (!campaign || !['SENDING', 'SCHEDULED'].includes(campaign.status)) return null;
    const eventIds = campaign.eventIds as string[];
    const associationIds = campaign.recipientIds as string[];
    if (!eventIds.length || !associationIds.length) return null;
    for (const eventId of [...eventIds].sort()) {
      const event = await lockMailEvent(tx, eventId);
      if (!event || isPastRetentionCutoff(event.eventDate, now)) return null;
    }
    const events = await tx.event.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, name: true, division: true, section: true, eventDate: true, venue: true, startTime: true, gameStartTime: true },
    });
    if (events.length !== eventIds.length) return null;
    const orderedEvents = eventIds.map((id) => events.find((event) => event.id === id)!).filter(Boolean);
    const associations = await tx.memberAssociation.findMany({
      where: { id: { in: associationIds }, active: true, primaryContactEmail: { not: null } },
      select: { id: true, name: true, primaryContactName: true, primaryContactEmail: true },
      orderBy: { name: 'asc' },
    });
    if (associations.length !== associationIds.length) return null;
    const targets = uniqueAssociationEmails(associations);
    if (!targets.length) return null;
    const fieldsForEvents = eventTemplateFields(orderedEvents);
    const existing = await tx.emailLog.findMany({ where: { batchId: campaign.batchId }, orderBy: { to: 'asc' } });
    const messages = targets.map((association) => {
      const fields = { ...fieldsForEvents, associationName: association.name, contactName: association.primaryContactName ?? '' };
      return {
        to: association.primaryContactEmail!.trim().toLowerCase(),
        associationId: association.id,
        subject: renderEmailTemplate(campaign.subject, fields),
        body: renderEmailTemplate(campaign.body, fields),
      };
    });
    if (existing.length) {
      if (existing.length !== messages.length) throw new EmailBatchConflictError();
      const expected = new Map(messages.map((message) => [message.to, message]));
      if (existing.some((row) => {
        const message = expected.get(row.to.trim().toLowerCase());
        return !message || row.eventId !== campaign.anchorEventId || row.siteCommunicationId !== campaign.id || row.subject !== message.subject || row.body !== message.body;
      })) throw new EmailBatchConflictError();
      return { anchorEventId: campaign.anchorEventId, rows: existing };
    }
    await tx.emailLog.createMany({
      skipDuplicates: true,
      data: messages.map((message) => ({
        eventId: campaign.anchorEventId,
        siteCommunicationId: campaign.id,
        associationId: message.associationId,
        senderUserId: campaign.senderUserId,
        batchId: campaign.batchId,
        idempotencyKey: deliveryIdempotencyKey(campaign.batchId, message.to),
        to: message.to,
        subject: message.subject,
        body: message.body,
        kind: 'association',
        status: 'PENDING',
      })),
    });
    const rows = await tx.emailLog.findMany({ where: { batchId: campaign.batchId }, orderBy: { to: 'asc' } });
    return { anchorEventId: campaign.anchorEventId, rows };
  }, { timeout: 60_000 });
}

function toCampaignDTO(
  campaign: { id: string; eventIds: Prisma.JsonValue; recipientIds: Prisma.JsonValue; batchId: string; subject: string; body: string; scheduledAt: Date | null; status: string; attempts: number; error: string | null; createdAt: Date },
  deliveries: Array<{ id: string; to: string; status: string; simulated: boolean; attempts: number; sentAt: Date | null; failedAt: Date | null; error: string | null; association: { name: string } | null }>,
  events: SiteEvent[],
): SiteAssociationCampaignDTO {
  return {
    id: campaign.id,
    eventIds: campaign.eventIds as string[],
    eventNames: events.map((event) => event.name),
    associationIds: campaign.recipientIds as string[],
    batchId: campaign.batchId,
    subject: campaign.subject,
    body: campaign.body,
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    status: campaign.status as SiteAssociationCampaignDTO['status'],
    attempts: campaign.attempts,
    error: campaign.error,
    createdAt: campaign.createdAt.toISOString(),
    deliveries: deliveries.map((row) => ({
      id: row.id, to: row.to, status: row.status as SiteAssociationCampaignDTO['deliveries'][number]['status'], simulated: row.simulated,
      attempts: row.attempts, sentAt: row.sentAt?.toISOString() ?? null, failedAt: row.failedAt?.toISOString() ?? null,
      error: row.error, associationName: row.association?.name ?? null,
    })),
  };
}

export async function listSiteAssociationCommunications(prisma: PrismaClient): Promise<SiteAssociationCampaignDTO[]> {
  const campaigns = await prisma.siteAssociationCommunication.findMany({
    orderBy: [{ createdAt: 'desc' }],
    include: { deliveries: { orderBy: { to: 'asc' }, include: { association: { select: { name: true } } } } },
  });
  const eventIds = [...new Set(campaigns.flatMap((campaign) => campaign.eventIds as string[]))];
  const events = await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, name: true, division: true, section: true, eventDate: true, venue: true, startTime: true, gameStartTime: true } });
  const eventById = new Map(events.map((event) => [event.id, event]));
  return campaigns.map((campaign) => toCampaignDTO(
    campaign,
    campaign.deliveries,
    (campaign.eventIds as string[]).map((id) => eventById.get(id)).filter((event): event is SiteEvent => Boolean(event)),
  ));
}

export async function dispatchSiteAssociationCommunication(
  prisma: PrismaClient,
  deps: { mailer: EmailProvider },
  campaignId: string,
  now: Date,
): Promise<SiteAssociationCampaignDTO | null> {
  const campaign = await prisma.siteAssociationCommunication.findUnique({ where: { id: campaignId } });
  if (!campaign) return null;
  const prepared = await createSiteDeliveryRows(prisma, campaignId, now);
  if (!prepared) {
    await prisma.siteAssociationCommunication.updateMany({
      where: { id: campaignId, status: { in: ['SENDING', 'SCHEDULED'] } },
      data: { status: 'FAILED', error: 'no_eligible_recipients_or_event_unavailable', completedAt: now },
    });
    return listSiteAssociationCommunications(prisma).then((rows) => rows.find((row) => row.id === campaignId) ?? null);
  }
  const summary = await dispatchSelectedRows({ prisma, mailer: deps.mailer }, prepared.rows, now);
  const completed = summary.sent + summary.simulated > 0 && summary.failed === 0 && summary.ambiguous === 0 && summary.pending === 0;
  await prisma.siteAssociationCommunication.updateMany({
    where: { id: campaignId, status: { in: ['SENDING', 'SCHEDULED'] } },
    data: {
      status: completed ? 'COMPLETED' : 'FAILED', completedAt: completed ? now : null,
      lastAttemptAt: now,
      error: completed ? null : `delivery_${summary.failed}_failed_${summary.ambiguous}_unknown_${summary.pending}_pending`,
    },
  });
  return listSiteAssociationCommunications(prisma).then((rows) => rows.find((row) => row.id === campaignId) ?? null);
}

export async function cancelSiteAssociationCommunication(prisma: PrismaClient, id: string, now: Date): Promise<boolean> {
  const updated = await prisma.siteAssociationCommunication.updateMany({
    where: { id, status: 'SCHEDULED', scheduledAt: { gt: now } },
    data: { status: 'CANCELLED' },
  });
  return updated.count === 1;
}

export async function retrySiteAssociationCommunication(
  prisma: PrismaClient,
  deps: { mailer: EmailProvider },
  id: string,
  deliveryIds: string[],
  now: Date,
  includeAmbiguous = false,
): Promise<DeliverySummary | null> {
  const campaign = await prisma.siteAssociationCommunication.findUnique({ where: { id }, select: { anchorEventId: true, batchId: true } });
  if (!campaign) return null;
  const result = await retryFailedDeliveries({ prisma, mailer: deps.mailer }, campaign.anchorEventId, campaign.batchId, deliveryIds, now, { includeAmbiguous });
  const completed = result.sent + result.simulated > 0 && result.failed === 0 && result.ambiguous === 0 && result.pending === 0;
  await prisma.siteAssociationCommunication.updateMany({
    where: { id, status: 'FAILED' },
    data: { status: completed ? 'COMPLETED' : 'FAILED', completedAt: completed ? now : null, error: completed ? null : `delivery_${result.failed}_failed_${result.ambiguous}_unknown_${result.pending}_pending` },
  });
  return result;
}

const STALE_CAMPAIGN_MS = 10 * 60_000;

async function recoverStaleSiteCampaigns(prisma: PrismaClient, now: Date): Promise<{ completed: number; failed: number }> {
  const stale = await prisma.siteAssociationCommunication.findMany({
    where: { OR: [
      { status: 'SENDING', lastAttemptAt: { lt: new Date(now.getTime() - STALE_CAMPAIGN_MS) } },
      { status: 'FAILED', error: 'scheduled_worker_interrupted' },
    ] },
    select: { id: true, batchId: true, attempts: true, lastAttemptAt: true, scheduledAt: true, status: true },
    orderBy: { id: 'asc' },
  });
  let completed = 0;
  let failed = 0;
  for (const campaign of stale) {
    const deliveries = await prisma.emailLog.findMany({ where: { batchId: campaign.batchId }, select: { status: true } });
    const allSent = deliveries.length > 0 && deliveries.every((delivery) => delivery.status === 'SENT');
    if (campaign.status === 'FAILED') {
      if (allSent) await prisma.siteAssociationCommunication.updateMany({
        where: { id: campaign.id, status: 'FAILED', error: 'scheduled_worker_interrupted' },
        data: { status: 'COMPLETED', completedAt: now, error: null },
      });
      continue;
    }
    const safeToResume = deliveries.every((delivery) => delivery.status === 'PENDING' || delivery.status === 'SENT');
    const status = allSent ? 'COMPLETED' : safeToResume ? 'SCHEDULED' : 'FAILED';
    const changed = await prisma.siteAssociationCommunication.updateMany({
      where: { id: campaign.id, status: 'SENDING', attempts: campaign.attempts, lastAttemptAt: campaign.lastAttemptAt },
      data: {
        status,
        scheduledAt: status === 'SCHEDULED' ? campaign.scheduledAt ?? now : campaign.scheduledAt,
        completedAt: status === 'COMPLETED' ? now : null,
        error: status === 'FAILED' ? 'scheduled_worker_interrupted' : null,
      },
    });
    if (changed.count !== 1) continue;
    if (status === 'COMPLETED') completed += 1;
    if (status === 'FAILED') failed += 1;
  }
  return { completed, failed };
}

export async function runDueSiteAssociationCommunications(
  prisma: PrismaClient,
  deps: { mailer: EmailProvider },
  now: Date,
): Promise<{ completed: number; failed: number }> {
  const recovered = await recoverStaleSiteCampaigns(prisma, now);
  const due = await prisma.siteAssociationCommunication.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'asc' }, take: 20,
  });
  let completed = recovered.completed;
  let failed = recovered.failed;
  for (const campaign of due) {
    const claim = await prisma.siteAssociationCommunication.updateMany({
      where: { id: campaign.id, status: 'SCHEDULED' },
      data: { status: 'SENDING', attempts: { increment: 1 }, lastAttemptAt: now, error: null },
    });
    if (claim.count !== 1) continue;
    try {
      const result = await dispatchSiteAssociationCommunication(prisma, deps, campaign.id, now);
      if (result?.status === 'COMPLETED') completed += 1;
      else failed += 1;
    } catch {
      await prisma.siteAssociationCommunication.updateMany({
        where: { id: campaign.id, status: 'SENDING' },
        data: { status: 'FAILED', error: 'scheduled_send_failed', completedAt: now },
      });
      failed += 1;
    }
  }
  return { completed, failed };
}
