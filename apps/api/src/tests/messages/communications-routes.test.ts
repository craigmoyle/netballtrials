import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { runDueScheduledMessages } from '../../messages/communications';

const app = createApp();
const outbox = app.testDeps.mailer as unknown as { sent: Array<{ to: string; subject: string; text: string; attachments?: Array<{ filename: string; content: Buffer }> }> };
let cookie: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'comms-admin@example.com');
  eventId = (await prisma.event.create({ data: eventFixture() })).id;
});

describe('event communications routes', () => {
  it('lists filtered participant/association contacts, keeps contacts private, and sends selected paid players', async () => {
    const association = await prisma.memberAssociation.create({ data: {
      name: 'MENA', primaryContactName: 'Morgan Association', primaryContactEmail: 'association@example.test',
    } });
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Paid', playerLastName: 'Player', playerNameNormalized: 'paid player',
      parentEmail: 'paid@example.test', status: 'PAID', checkedInAt: new Date(), bibNumber: 8,
      rank1Position: 'GS', rank2Position: 'GA', rank3Position: 'WA',
    }) });
    await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Pending', playerLastName: 'Player', playerNameNormalized: 'pending player',
      parentEmail: 'pending@example.test', status: 'PENDING', checkedInAt: null, bibNumber: null,
    }) });
    const publicContacts = await app.inject({ method: 'GET', url: '/api/public/associations' });
    expect(publicContacts.json()).toEqual([{ id: association.id, name: 'MENA', active: true }]);

    const recipientResponse = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/communications/recipients`, cookies: { nt_session: cookie } });
    expect(recipientResponse.json()).toMatchObject({
      participants: expect.arrayContaining([
        expect.objectContaining({ id: paid.id, name: 'Paid Player', number: 8, email: 'paid@example.test', positions: ['GS', 'GA', 'WA'], checkedIn: true }),
      ]),
      associations: [expect.objectContaining({ id: association.id, email: 'association@example.test' })],
    });
    expect(JSON.stringify(publicContacts.json())).not.toContain('association@example.test');

    const preview = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/preview`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id] },
    });
    expect(preview.json()).toMatchObject({ count: 1, recipients: [expect.objectContaining({ id: paid.id })] });

    const sent = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], subject: 'Trials update', text: 'Bring water.', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'paid@example.test', subject: 'Trials update', text: 'Bring water.' });
    const log = await prisma.emailLog.findFirstOrThrow({ where: { batchId: sent.json().batchId } });
    expect(log).toMatchObject({ registrationId: paid.id, kind: 'message', status: 'SENT' });
    const sentCount = outbox.sent.length;
    const duplicate = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], subject: 'Trials update', text: 'Bring water.', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(outbox.sent).toHaveLength(sentCount);
    const conflict = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], subject: 'Changed', text: 'Bring water.', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('does not expose participant contacts after the retention cutoff', async () => {
    const oldEvent = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-09-12T00:00:00Z') }) });
    const association = await prisma.memberAssociation.create({ data: { name: 'Old event association', primaryContactEmail: 'association@example.test' } });
    await prisma.registration.create({ data: registrationFixture(oldEvent.id, { status: 'PAID', parentEmail: 'private@example.test' }) });
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${oldEvent.id}/communications/recipients`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().participants).toEqual([]);
    expect(response.json().associations).toEqual([expect.objectContaining({ id: association.id })]);
    expect(response.body).not.toContain('private@example.test');
  });

  it('renders participant placeholders and combines sibling names in one household email', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { name: 'Spring Trials', venue: 'SNC' } });
    const single = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace', parentEmail: 'single@example.test', status: 'PAID',
    }) });
    const firstSibling = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Bea', playerLastName: 'One', playerNameNormalized: 'bea one', parentEmail: 'family@example.test', status: 'PAID',
    }) });
    const secondSibling = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Cy', playerLastName: 'Two', playerNameNormalized: 'cy two', parentEmail: 'family@example.test', status: 'PAID',
    }) });

    const personalized = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [single.id], subject: 'Hello {{playerFirstName}}', text: '{{playerName}} — {{eventName}} at {{venue}}', batchId: '00000000-0000-4000-8000-000000000076' },
    });
    expect(personalized.statusCode).toBe(200);
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'single@example.test', subject: 'Hello Ada', text: 'Ada Lovelace — Spring Trials at SNC' });

    const household = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [firstSibling.id, secondSibling.id], subject: 'Your players', text: '{{playerNames}}', batchId: '00000000-0000-4000-8000-000000000077' },
    });
    expect(household.statusCode).toBe(200);
    expect(household.json().sent).toBe(1);
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'family@example.test', text: expect.stringContaining('Bea One') });
    expect(outbox.sent.at(-1)?.text).toContain('Cy Two');
  });

  it('sends association messages only to currently active contacts and attaches the event policy PDF', async () => {
    const association = await prisma.memberAssociation.create({ data: {
      name: 'MENA', primaryContactName: 'Morgan Association', primaryContactEmail: 'association@example.test',
    } });
    await prisma.eventPolicyDocument.create({ data: { eventId, fileName: 'Selection policy.pdf', bytes: Buffer.from('%PDF-1.4 test') } });
    const sent = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'associations', recipientIds: [association.id], subject: 'Association notice', text: 'Please share with your teams.', batchId: '00000000-0000-4000-8000-000000000078' },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ sent: 1 });
    const email = outbox.sent.at(-1)!;
    expect(email.to).toBe('association@example.test');
    expect(email.attachments?.[0]).toMatchObject({ filename: 'Selection policy.pdf' });
    expect(Buffer.from(email.attachments![0]!.content).toString()).toBe('%PDF-1.4 test');
    expect(await prisma.emailLog.findFirstOrThrow({ where: { batchId: sent.json().batchId } })).toMatchObject({ associationId: association.id, registrationId: null, kind: 'association' });
  });

  it('sends one site-level association message for multiple events and renders association/event fields', async () => {
    const first = await prisma.event.create({ data: { ...eventFixture(), name: 'Spring Trials', eventDate: new Date('2027-09-12T00:00:00.000Z'), venue: 'SNC' } });
    const second = await prisma.event.create({ data: { ...eventFixture(), name: 'Open Trials', eventDate: new Date('2027-10-12T00:00:00.000Z'), venue: 'MENA' } });
    const association = await prisma.memberAssociation.create({ data: { name: 'MENA', primaryContactName: 'Morgan Contact', primaryContactEmail: 'morgan@example.test' } });
    const input = {
      eventIds: [first.id, second.id], associationIds: [association.id], batchId: '00000000-0000-4000-8000-000000000041',
      subject: 'Details for {{associationName}}', text: 'Hello {{contactName}}.\\n{{eventList}}',
    };
    const preview = await app.inject({ method: 'POST', url: '/api/admin/communications/site/preview', cookies: { nt_session: cookie }, payload: input });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      count: 1,
      subject: 'Details for MENA',
      text: expect.stringContaining('Spring Trials'),
      events: expect.arrayContaining([expect.objectContaining({ name: 'Open Trials' })]),
    });
    expect(preview.json().text).toContain('Open Trials');

    const sent = await app.inject({ method: 'POST', url: '/api/admin/communications/site/send', cookies: { nt_session: cookie }, payload: input });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'COMPLETED', eventNames: ['Spring Trials', 'Open Trials'], deliveries: [expect.objectContaining({ to: 'morgan@example.test', status: 'SENT' })] });
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'morgan@example.test', subject: 'Details for MENA', text: expect.stringContaining('Hello Morgan Contact.') });
    expect(outbox.sent.at(-1)?.text).toContain('Spring Trials');
    expect(outbox.sent.at(-1)?.text).toContain('Open Trials');
    const log = await prisma.emailLog.findFirstOrThrow({ where: { siteCommunicationId: sent.json().id } });
    expect(log).toMatchObject({ eventId: first.id, associationId: association.id, registrationId: null, kind: 'association', status: 'SENT' });

    const sentCount = outbox.sent.length;
    const duplicate = await app.inject({ method: 'POST', url: '/api/admin/communications/site/send', cookies: { nt_session: cookie }, payload: input });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().id).toBe(sent.json().id);
    expect(outbox.sent).toHaveLength(sentCount);
    const conflict = await app.inject({
      method: 'POST', url: '/api/admin/communications/site/send', cookies: { nt_session: cookie },
      payload: { ...input, text: 'different body' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('sends a due scheduled site-level association message', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), name: 'Spring Trials', eventDate: new Date('2027-09-12T00:00:00.000Z') } });
    const association = await prisma.memberAssociation.create({ data: { name: 'MENA', primaryContactName: 'Morgan Contact', primaryContactEmail: 'morgan@example.test' } });
    const created = await app.inject({
      method: 'POST', url: '/api/admin/communications/site/schedule', cookies: { nt_session: cookie },
      payload: { eventIds: [event.id], associationIds: [association.id], subject: 'Upcoming {{eventName}}', text: '{{venue}}\\n{{eventList}}', scheduledLocal: '2027-01-15T10:30' },
    });
    expect(created.statusCode).toBe(201);
    const campaign = await prisma.siteAssociationCommunication.findUniqueOrThrow({ where: { id: created.json().id } });
    await prisma.event.update({ where: { id: event.id }, data: { venue: 'Updated venue' } });
    const result = await runDueScheduledMessages({ prisma, mailer: app.testDeps.mailer }, new Date('2027-01-15T00:00:00.000Z'));
    expect(result).toEqual({ completed: 1, failed: 0 });
    expect((await prisma.siteAssociationCommunication.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('COMPLETED');
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'morgan@example.test', subject: 'Upcoming Spring Trials' });
    expect(outbox.sent.at(-1)?.text).toContain('Updated venue');
    expect(outbox.sent.at(-1)?.text).not.toContain('SNC');
  });

  it('creates a future Melbourne schedule, lists it, and cancels before send', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const scheduledLocal = '2027-01-15T10:30';
    const scheduleInput = { audience: 'participants', recipientIds: [paid.id], subject: 'Trial reminder', text: 'See you soon.', scheduledLocal, batchId: '00000000-0000-4000-8000-000000000075' };
    const created = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/schedule`, cookies: { nt_session: cookie },
      payload: scheduleInput,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'SCHEDULED', audience: 'participants', subject: 'Trial reminder', recipientIds: [paid.id] });
    expect(created.json().scheduledAt).toBe('2027-01-14T23:30:00.000Z');
    const duplicate = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/schedule`, cookies: { nt_session: cookie }, payload: scheduleInput,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().id).toBe(created.json().id);
    const list = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/communications/scheduled`, cookies: { nt_session: cookie } });
    expect(list.json()).toHaveLength(1);
    const cancelled = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/communications/scheduled/${created.json().id}/cancel`, cookies: { nt_session: cookie } });
    expect(cancelled.json()).toEqual({ status: 'CANCELLED' });
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: created.json().id } })).status).toBe('CANCELLED');
  });

  it('sends a due scheduled message from the scheduler and retains its batch delivery history', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const schedule = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'schedule-due',
      subject: 'Scheduled note', body: 'See you soon.', scheduledAt: new Date(Date.now() - 60_000),
    } });
    const result = await runDueScheduledMessages({ prisma, mailer: app.testDeps.mailer }, new Date());

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe('COMPLETED');
    expect(await prisma.emailLog.findFirstOrThrow({ where: { batchId: schedule.batchId } })).toMatchObject({ to: 'parent@example.test', status: 'SENT' });
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'parent@example.test', subject: 'Scheduled note' });
  });

  it('recovers stale scheduled sends with no or only known-unsent deliveries', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const staleAt = new Date(Date.now() - 15 * 60_000);
    const schedule = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'schedule-interrupted-empty',
      subject: 'Recovered schedule', body: 'See you soon.', scheduledAt: staleAt, status: 'SENDING', attempts: 1, lastAttemptAt: staleAt,
    } });
    const result = await runDueScheduledMessages({ prisma, mailer: app.testDeps.mailer }, new Date());

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe('COMPLETED');
    expect(await prisma.emailLog.count({ where: { batchId: schedule.batchId, status: 'SENT' } })).toBe(1);
  });

  it('marks a stale schedule complete when every delivery already succeeded', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const staleAt = new Date(Date.now() - 15 * 60_000);
    const schedule = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'schedule-interrupted-sent',
      subject: 'Already sent', body: 'See you soon.', scheduledAt: staleAt, status: 'SENDING', attempts: 1, lastAttemptAt: staleAt,
    } });
    await prisma.emailLog.create({
      data: { eventId, registrationId: paid.id, batchId: schedule.batchId, idempotencyKey: 'schedule-interrupted-sent-key', to: paid.parentEmail, subject: schedule.subject, body: schedule.body, kind: 'message', status: 'SENT', attempts: 1, sentAt: staleAt },
    });
    const send = vi.fn();
    const result = await runDueScheduledMessages({ prisma, mailer: { send } }, new Date());

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe('COMPLETED');
    expect(send).not.toHaveBeenCalled();
  });

  it('marks an interrupted scheduled send failed without replaying an uncertain delivery', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const staleAt = new Date(Date.now() - 15 * 60_000);
    const schedule = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'schedule-interrupted-unknown',
      subject: 'Uncertain schedule', body: 'See you soon.', scheduledAt: staleAt, status: 'SENDING', attempts: 1, lastAttemptAt: staleAt,
    } });
    await prisma.emailLog.create({
      data: { eventId, registrationId: paid.id, batchId: schedule.batchId, idempotencyKey: 'schedule-interrupted-key', to: paid.parentEmail, subject: schedule.subject, body: schedule.body, kind: 'message', status: 'AMBIGUOUS', attempts: 1, error: 'delivery_interrupted_after_claim' },
    });
    const send = vi.fn();
    const result = await runDueScheduledMessages({ prisma, mailer: { send } }, new Date());

    expect(result).toEqual({ completed: 0, failed: 1 });
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe('FAILED');
    expect(send).not.toHaveBeenCalled();
  });

  it('recovers a stale site campaign that had not created any deliveries', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2027-09-12T00:00:00Z') } });
    const association = await prisma.memberAssociation.create({ data: { name: 'Restart Association', primaryContactEmail: 'restart@example.test' } });
    const staleAt = new Date(Date.now() - 15 * 60_000);
    const campaign = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: event.id, eventIds: [event.id], recipientIds: [association.id], batchId: 'site-interrupted-empty',
      subject: 'Recovered site campaign', body: 'Hello', status: 'SENDING', attempts: 1, lastAttemptAt: staleAt,
    } });
    const result = await runDueScheduledMessages({ prisma, mailer: app.testDeps.mailer }, new Date());

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect((await prisma.siteAssociationCommunication.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe('COMPLETED');
    expect(await prisma.emailLog.count({ where: { siteCommunicationId: campaign.id, status: 'SENT' } })).toBe(1);
  });

  it('revalidates scheduled participant eligibility at send time', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const schedule = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'schedule-revalidate',
      subject: 'Trial reminder', body: 'See you soon.', scheduledAt: new Date(Date.now() - 60_000),
    } });
    await prisma.registration.update({ where: { id: paid.id }, data: { status: 'WITHDRAWN' } });

    const result = await runDueScheduledMessages({ prisma, mailer: app.testDeps.mailer }, new Date());
    expect(result).toEqual({ completed: 0, failed: 1 });
    expect((await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe('FAILED');
    expect(await prisma.emailLog.count({ where: { batchId: schedule.batchId } })).toBe(0);
  });

  it('rejects schedules in the past and duplicate template names', async () => {
    const past = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/schedule`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: ['unused'], subject: 'Past', text: 'No', scheduledLocal: '2020-01-01T10:00', batchId: '00000000-0000-4000-8000-000000000079' }
    });
    expect(past.statusCode).toBe(400);
    const template = { name: 'Trial update', audience: 'participants', subject: 'Update', body: 'Hello' };
    expect((await app.inject({ method: 'POST', url: '/api/admin/communications/templates', cookies: { nt_session: cookie }, payload: template })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/admin/communications/templates', cookies: { nt_session: cookie }, payload: template })).statusCode).toBe(409);
  });
});
