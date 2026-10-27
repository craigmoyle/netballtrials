import { beforeEach, describe, expect, it } from 'vitest';
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
  });

  it('sends association messages only to currently active contacts and attaches the event policy PDF', async () => {
    const association = await prisma.memberAssociation.create({ data: {
      name: 'MENA', primaryContactName: 'Morgan Association', primaryContactEmail: 'association@example.test',
    } });
    await prisma.eventPolicyDocument.create({ data: { eventId, fileName: 'Selection policy.pdf', bytes: Buffer.from('%PDF-1.4 test') } });
    const sent = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'associations', recipientIds: [association.id], subject: 'Association notice', text: 'Please share with your teams.' },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ sent: 1 });
    const email = outbox.sent.at(-1)!;
    expect(email.to).toBe('association@example.test');
    expect(email.attachments?.[0]).toMatchObject({ filename: 'Selection policy.pdf' });
    expect(Buffer.from(email.attachments![0]!.content).toString()).toBe('%PDF-1.4 test');
    expect(await prisma.emailLog.findFirstOrThrow({ where: { batchId: sent.json().batchId } })).toMatchObject({ associationId: association.id, registrationId: null, kind: 'association' });
  });

  it('creates a future Melbourne schedule, lists it, and cancels before send', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const scheduledLocal = '2027-01-15T10:30';
    const created = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/schedule`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], subject: 'Trial reminder', text: 'See you soon.', scheduledLocal },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'SCHEDULED', audience: 'participants', subject: 'Trial reminder', recipientIds: [paid.id] });
    expect(created.json().scheduledAt).toBe('2027-01-14T23:30:00.000Z');
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
      payload: { audience: 'participants', recipientIds: ['unused'], subject: 'Past', text: 'No', scheduledLocal: '2020-01-01T10:00' },
    });
    expect(past.statusCode).toBe(400);
    const template = { name: 'Trial update', audience: 'participants', subject: 'Update', body: 'Hello' };
    expect((await app.inject({ method: 'POST', url: '/api/admin/communications/templates', cookies: { nt_session: cookie }, payload: template })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/admin/communications/templates', cookies: { nt_session: cookie }, payload: template })).statusCode).toBe(409);
  });
});
