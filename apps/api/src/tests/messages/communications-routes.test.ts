import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { runDueScheduledMessages } from '../../messages/communications';
import { dispatchSiteAssociationCommunication } from '../../messages/site-association-communications';

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

    const reviewed = { id: paid.id, email: 'paid@example.test' };
    const sent = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], previewedRecipients: [reviewed], subject: 'Trials update', text: 'Bring water.', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ sent: 0, simulated: 1, failed: 0 });
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'paid@example.test', subject: '[TEST] Trials update', text: expect.stringContaining('Bring water.') });
    const log = await prisma.emailLog.findFirstOrThrow({ where: { batchId: sent.json().batchId } });
    expect(log).toMatchObject({ registrationId: paid.id, kind: 'message', status: 'SENT' });
    const sentCount = outbox.sent.length;
    const duplicate = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], previewedRecipients: [reviewed], subject: 'Trials update', text: 'Bring water.', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(outbox.sent).toHaveLength(sentCount);
    const conflict = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [paid.id], previewedRecipients: [reviewed], subject: 'Changed', text: 'Bring water.', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('includes verified incomplete registrations but excludes unverified registrations from preview and send', async () => {
    const verified = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Verified', playerLastName: 'Pending', playerNameNormalized: 'verified pending',
      parentEmail: 'verified-pending@example.test', status: 'PENDING', parentEmailVerifiedAt: new Date(),
    }) });
    const unverified = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Unverified', playerLastName: 'Pending', playerNameNormalized: 'unverified pending',
      parentEmail: 'unverified-pending@example.test', status: 'PENDING', parentEmailVerifiedAt: null,
    }) });

    const list = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/communications/recipients`, cookies: { nt_session: cookie } });
    expect(list.json().participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: verified.id, eligible: true, emailVerified: true }),
      expect.objectContaining({ id: unverified.id, eligible: false, emailVerified: false }),
    ]));
    const preview = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/preview`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [verified.id, unverified.id] },
    });
    expect(preview.json()).toMatchObject({ count: 1, recipients: [expect.objectContaining({ id: verified.id })] });
    const sent = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [verified.id], previewedRecipients: [{ id: verified.id, email: 'verified-pending@example.test' }], subject: 'Finish registration', text: 'Complete payment.', batchId: '00000000-0000-4000-8000-000000000080' },
    });
    expect(sent.statusCode).toBe(200);
    expect(outbox.sent.at(-1)?.to).toBe('verified-pending@example.test');
    const rejected = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [unverified.id], previewedRecipients: [{ id: unverified.id, email: 'unverified-pending@example.test' }], subject: 'No', text: 'No', batchId: '00000000-0000-4000-8000-000000000081' },
    });
    expect(rejected.statusCode).toBe(422);
  });

  it('does not expose participant contacts after the retention cutoff', async () => {
    const oldEvent = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-09-12T00:00:00Z') }) });
    const association = await prisma.memberAssociation.create({ data: { name: 'Old event association', primaryContactName: 'Old contact', primaryContactEmail: 'association@example.test' } });
    await prisma.registration.create({ data: registrationFixture(oldEvent.id, { status: 'PAID', parentEmail: 'private@example.test' }) });
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${oldEvent.id}/communications/recipients`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().participants).toEqual([]);
    expect(response.json().associations).toEqual([expect.objectContaining({ id: association.id })]);
    expect(response.body).not.toContain('private@example.test');
  });

  it('keeps every selected sibling in the communication preview', async () => {
    const first = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Bea', playerLastName: 'One', playerNameNormalized: 'bea one', parentEmail: 'family@example.test', status: 'PAID',
    }) });
    const second = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Cy', playerLastName: 'Two', playerNameNormalized: 'cy two', parentEmail: 'family@example.test', status: 'PAID',
    }) });

    const preview = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/preview`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [first.id, second.id] },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ count: 1, recipients: expect.arrayContaining([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: second.id }),
    ]) });
  });

  it('rejects a send when the reviewed recipient list has changed', async () => {
    const player = await prisma.registration.create({ data: registrationFixture(eventId, {
      status: 'PAID', parentEmail: 'before@example.test',
    }) });
    const snapshot = [{ id: player.id, email: 'before@example.test' }];
    await prisma.registration.update({ where: { id: player.id }, data: { parentEmail: 'after@example.test' } });

    const sent = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: {
        audience: 'participants', recipientIds: [player.id], previewedRecipients: snapshot,
        subject: 'Changed audience', text: 'Do not send to an unreviewed address.',
        batchId: '00000000-0000-4000-8000-000000000090',
      },
    });

    expect(sent.statusCode).toBe(409);
    expect(sent.json()).toEqual({ error: 'recipients_changed' });
    expect(outbox.sent.some((message) => message.subject === 'Changed audience')).toBe(false);
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
      payload: { audience: 'participants', recipientIds: [single.id], previewedRecipients: [{ id: single.id, email: 'single@example.test' }], subject: 'Hello {{playerFirstName}}', text: '{{playerName}} — {{eventName}} at {{venue}}', batchId: '00000000-0000-4000-8000-000000000076' },
    });
    expect(personalized.statusCode).toBe(200);
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'single@example.test', subject: '[TEST] Hello Ada', text: expect.stringContaining('Ada Lovelace — Spring Trials at SNC') });

    const household = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/communications/send`, cookies: { nt_session: cookie },
      payload: { audience: 'participants', recipientIds: [firstSibling.id, secondSibling.id], previewedRecipients: [{ id: firstSibling.id, email: 'family@example.test' }, { id: secondSibling.id, email: 'family@example.test' }], subject: 'Your players', text: '{{playerNames}}', batchId: '00000000-0000-4000-8000-000000000077' },
    });
    expect(household.statusCode).toBe(200);
    expect(household.json()).toMatchObject({ sent: 0, simulated: 1 });
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
      payload: { audience: 'associations', recipientIds: [association.id], previewedRecipients: [{ id: association.id, email: 'association@example.test' }], subject: 'Association notice', text: 'Please share with your teams.', batchId: '00000000-0000-4000-8000-000000000078' },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ sent: 0, simulated: 1 });
    const email = outbox.sent.at(-1)!;
    expect(email.to).toBe('association@example.test');
    expect(email.attachments?.[0]).toMatchObject({ filename: 'Selection policy.pdf' });
    expect(Buffer.from(email.attachments![0]!.content).toString()).toBe('%PDF-1.4 test');
    expect(await prisma.emailLog.findFirstOrThrow({ where: { batchId: sent.json().batchId } })).toMatchObject({ associationId: association.id, registrationId: null, kind: 'association' });
  });

  it('anchors a multi-event campaign to its latest event', async () => {
    const later = await prisma.event.create({ data: eventFixture({ name: 'Later event', eventDate: new Date('2027-10-12T00:00:00.000Z') }) });
    const earlier = await prisma.event.create({ data: eventFixture({ name: 'Earlier event', eventDate: new Date('2027-09-12T00:00:00.000Z') }) });
    const association = await prisma.memberAssociation.create({ data: { name: 'MENA', primaryContactName: 'Anchor contact', primaryContactEmail: 'anchor@example.test' } });

    const sent = await app.inject({
      method: 'POST', url: '/api/admin/communications/site/send', cookies: { nt_session: cookie },
      payload: { eventIds: [later.id, earlier.id], associationIds: [association.id], previewedRecipients: [{ id: association.id, email: 'anchor@example.test' }], subject: 'Trials', text: '{{eventList}}', batchId: '00000000-0000-4000-8000-000000000090' },
    });

    expect(sent.statusCode).toBe(200);
    expect(await prisma.siteAssociationCommunication.findUniqueOrThrow({ where: { id: sent.json().id } })).toMatchObject({ anchorEventId: later.id });
  });

  it('sends one site-level association message for multiple events and renders association/event fields', async () => {
    const first = await prisma.event.create({ data: { ...eventFixture(), name: 'Spring Trials', eventDate: new Date('2027-09-12T00:00:00.000Z'), venue: 'SNC' } });
    const second = await prisma.event.create({ data: { ...eventFixture(), name: 'Open Trials', eventDate: new Date('2027-10-12T00:00:00.000Z'), venue: 'MENA' } });
    const association = await prisma.memberAssociation.create({ data: { name: 'MENA', primaryContactName: 'Morgan Contact', primaryContactEmail: 'morgan@example.test' } });
    const input = {
      eventIds: [first.id, second.id], associationIds: [association.id], previewedRecipients: [{ id: association.id, email: 'morgan@example.test' }], batchId: '00000000-0000-4000-8000-000000000041',
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
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'morgan@example.test', subject: '[TEST] Details for MENA', text: expect.stringContaining('Hello Morgan Contact.') });
    expect(outbox.sent.at(-1)?.text).toContain('Spring Trials');
    expect(outbox.sent.at(-1)?.text).toContain('Open Trials');
    const log = await prisma.emailLog.findFirstOrThrow({ where: { siteCommunicationId: sent.json().id } });
    expect(log).toMatchObject({ eventId: second.id, associationId: association.id, registrationId: null, kind: 'association', status: 'SENT' });

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

  it('sends a site campaign to active recipients when another selected association is inactive', async () => {
    const event = await prisma.event.create({ data: eventFixture({ name: 'Association event', eventDate: new Date('2027-09-12T00:00:00Z') }) });
    const active = await prisma.memberAssociation.create({ data: { name: 'Active', primaryContactName: 'Active contact', primaryContactEmail: 'active@example.test' } });
    const inactive = await prisma.memberAssociation.create({ data: { name: 'Inactive', active: false, primaryContactName: 'Inactive contact', primaryContactEmail: 'inactive@example.test' } });

    const sent = await app.inject({
      method: 'POST', url: '/api/admin/communications/site/send', cookies: { nt_session: cookie },
      payload: { eventIds: [event.id], associationIds: [active.id, inactive.id], previewedRecipients: [{ id: active.id, email: 'active@example.test' }], subject: 'Trials', text: 'Hello', batchId: '00000000-0000-4000-8000-000000000091' },
    });

    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'COMPLETED', deliveries: [expect.objectContaining({ to: 'active@example.test', status: 'SENT' })] });
    expect(await prisma.emailLog.count({ where: { siteCommunicationId: sent.json().id } })).toBe(1);
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
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'morgan@example.test', subject: '[TEST] Upcoming Spring Trials' });
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

  it('rejects a site campaign after its reviewed contact changes', async () => {
    const event = await prisma.event.create({ data: eventFixture({ name: 'Reviewed contact event', eventDate: new Date('2027-09-12T00:00:00Z') }) });
    const association = await prisma.memberAssociation.create({ data: {
      name: 'Reviewed association', primaryContactName: 'Review contact', primaryContactEmail: 'before@example.test',
    } });
    await prisma.memberAssociation.update({ where: { id: association.id }, data: { primaryContactEmail: 'after@example.test' } });

    const sent = await app.inject({
      method: 'POST', url: '/api/admin/communications/site/send', cookies: { nt_session: cookie },
      payload: {
        eventIds: [event.id], associationIds: [association.id],
        previewedRecipients: [{ id: association.id, email: 'before@example.test' }],
        subject: 'Association update', text: 'Review this address.', batchId: '00000000-0000-4000-8000-000000000092',
      },
    });

    expect(sent.statusCode).toBe(409);
    expect(sent.json()).toEqual({ error: 'recipients_changed' });
  });

  it('edits a scheduled event message while preserving its batch id and refreshing its attachment', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'old@example.test' }) });
    const association = await prisma.memberAssociation.create({ data: { name: 'Edit MENA', primaryContactName: 'Edit contact', primaryContactEmail: 'new@example.test' } });
    const created = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'preserved-event-batch',
      subject: 'Old subject', body: 'Old body', scheduledAt: new Date('2099-01-14T23:30:00.000Z'),
      policyAttachment: { fileName: 'old.pdf', contentBase64: 'b2xk' },
    } });
    await prisma.eventPolicyDocument.create({ data: { eventId, fileName: 'new.pdf', bytes: Buffer.from('new policy') } });

    const updated = await app.inject({
      method: 'PUT', url: `/api/admin/events/${eventId}/communications/scheduled/${created.id}`, cookies: { nt_session: cookie },
      payload: { audience: 'associations', recipientIds: [association.id], subject: 'New subject', text: 'New body', scheduledLocal: '2099-02-15T10:30', expectedUpdatedAt: created.updatedAt.toISOString() },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: created.id, batchId: 'preserved-event-batch', audience: 'associations', recipientIds: [association.id], subject: 'New subject', body: 'New body', attachmentName: 'new.pdf', scheduledAt: '2099-02-14T23:30:00.000Z' });
    expect(await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ batchId: created.batchId, audience: 'associations', subject: 'New subject' });
    const stale = await app.inject({
      method: 'PUT', url: `/api/admin/events/${eventId}/communications/scheduled/${created.id}`, cookies: { nt_session: cookie },
      payload: { audience: 'associations', recipientIds: [association.id], subject: 'Stale overwrite', text: 'Stale', scheduledLocal: '2099-02-17T10:30', expectedUpdatedAt: created.updatedAt.toISOString() },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'schedule_changed' });
    await prisma.memberAssociation.update({ where: { id: association.id }, data: { active: false } });
    const ineligible = await app.inject({
      method: 'PUT', url: `/api/admin/events/${eventId}/communications/scheduled/${created.id}`, cookies: { nt_session: cookie },
      payload: { audience: 'associations', recipientIds: [association.id], subject: 'Still new', text: 'Still new', scheduledLocal: '2099-02-16T10:30', expectedUpdatedAt: updated.json().updatedAt },
    });
    expect(ineligible.statusCode).toBe(422);

    const past = await app.inject({
      method: 'PUT', url: `/api/admin/events/${eventId}/communications/scheduled/${created.id}`, cookies: { nt_session: cookie },
      payload: { audience: 'associations', recipientIds: [association.id], subject: 'No', text: 'No', scheduledLocal: '2020-02-15T10:30', expectedUpdatedAt: updated.json().updatedAt },
    });
    expect(past.statusCode).toBe(400);
  });

  it('edits a scheduled site association campaign while preserving its batch id', async () => {
    const first = await prisma.event.create({ data: { ...eventFixture(), name: 'First', eventDate: new Date('2099-01-20T00:00:00.000Z') } });
    const second = await prisma.event.create({ data: { ...eventFixture(), name: 'Second', eventDate: new Date('2099-02-20T00:00:00.000Z') } });
    const oldAssociation = await prisma.memberAssociation.create({ data: { name: 'Old association', primaryContactName: 'Old contact', primaryContactEmail: 'old-association@example.test' } });
    const newAssociation = await prisma.memberAssociation.create({ data: { name: 'New association', primaryContactName: 'New contact', primaryContactEmail: 'new-association@example.test' } });
    const created = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: first.id, eventIds: [first.id], recipientIds: [oldAssociation.id], batchId: 'site-associations:preserved-site-batch',
      subject: 'Old site subject', body: 'Old site body', scheduledAt: new Date('2099-01-10T00:00:00.000Z'), status: 'SCHEDULED',
    } });

    const updated = await app.inject({
      method: 'PUT', url: `/api/admin/communications/site/campaigns/${created.id}`, cookies: { nt_session: cookie },
      payload: { eventIds: [second.id], associationIds: [newAssociation.id], subject: 'New site subject', text: 'New site body', scheduledLocal: '2099-02-15T10:30', expectedUpdatedAt: created.updatedAt.toISOString() },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: created.id, eventIds: [second.id], associationIds: [newAssociation.id], batchId: created.batchId, subject: 'New site subject', body: 'New site body', scheduledAt: '2099-02-14T23:30:00.000Z' });
    const stale = await app.inject({
      method: 'PUT', url: `/api/admin/communications/site/campaigns/${created.id}`, cookies: { nt_session: cookie },
      payload: { eventIds: [second.id], associationIds: [newAssociation.id], subject: 'Stale site overwrite', text: 'Stale', scheduledLocal: '2099-02-17T10:30', expectedUpdatedAt: created.updatedAt.toISOString() },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'schedule_changed' });
    await prisma.memberAssociation.update({ where: { id: newAssociation.id }, data: { active: false } });
    const ineligible = await app.inject({
      method: 'PUT', url: `/api/admin/communications/site/campaigns/${created.id}`, cookies: { nt_session: cookie },
      payload: { eventIds: [second.id], associationIds: [newAssociation.id], subject: 'No longer eligible', text: 'No', scheduledLocal: '2099-02-16T10:30', expectedUpdatedAt: updated.json().updatedAt },
    });
    expect(ineligible.statusCode).toBe(422);
  });

  it('does not send a stale scheduled message if an Admin edits it after the scheduler reads it', async () => {
    const paid = await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID', parentEmail: 'parent@example.test' }) });
    const schedule = await prisma.scheduledMessage.create({ data: {
      eventId, audience: 'participants', recipientIds: [paid.id], batchId: 'schedule-edit-race',
      subject: 'Stale subject', body: 'Stale body', scheduledAt: new Date(Date.now() - 60_000),
    } });
    let edited = false;
    const racing = prisma.$extends({ query: { scheduledMessage: { async findMany({ args, query }) {
      const rows = await query(args);
      if (!edited && rows.some((row) => row.id === schedule.id && row.status === 'SCHEDULED')) {
        edited = true;
        await prisma.scheduledMessage.update({ where: { id: schedule.id }, data: { subject: 'Edited subject', body: 'Edited body', scheduledAt: new Date(Date.now() + 60_000) } });
      }
      return rows;
    } } } });
    const send = vi.fn();

    const result = await runDueScheduledMessages({ prisma: racing as typeof prisma, mailer: { send } }, new Date());

    expect(result).toEqual({ completed: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.scheduledMessage.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({ status: 'SCHEDULED', subject: 'Edited subject', body: 'Edited body' });
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
    expect(outbox.sent.at(-1)).toMatchObject({ to: 'parent@example.test', subject: '[TEST] Scheduled note' });
  });

  it('does not let a late site sender overwrite a newer campaign attempt', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2027-09-12T00:00:00Z') } });
    const association = await prisma.memberAssociation.create({ data: { name: 'Late Association', primaryContactName: 'Late contact', primaryContactEmail: 'late-association@example.test' } });
    const campaign = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: event.id, eventIds: [event.id], recipientIds: [association.id], batchId: 'site-late-completion',
      subject: 'Late completion', body: 'Hello', scheduledAt: new Date(Date.now() - 60_000), status: 'SENDING', attempts: 1,
    } });
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const sending = dispatchSiteAssociationCommunication(prisma, { mailer: { send: vi.fn(async () => { entered(); await releasePromise; }) } }, campaign.id, new Date());
    await enteredPromise;
    await prisma.siteAssociationCommunication.update({ where: { id: campaign.id }, data: { attempts: 2, lastAttemptAt: new Date() } });
    release();
    await sending;

    expect(await prisma.siteAssociationCommunication.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ status: 'SENDING', attempts: 2 });
  });

  it('does not send a site campaign if an Admin edits it after the scheduler reads it', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), eventDate: new Date('2027-09-12T00:00:00Z') } });
    const association = await prisma.memberAssociation.create({ data: { name: 'Race Association', primaryContactName: 'Race contact', primaryContactEmail: 'race@example.test' } });
    const campaign = await prisma.siteAssociationCommunication.create({ data: {
      anchorEventId: event.id, eventIds: [event.id], recipientIds: [association.id], batchId: 'site-schedule-edit-race',
      subject: 'Stale site subject', body: 'Stale site body', scheduledAt: new Date(Date.now() - 60_000), status: 'SCHEDULED',
    } });
    let edited = false;
    const racing = prisma.$extends({ query: { siteAssociationCommunication: { async findMany({ args, query }) {
      const rows = await query(args);
      if (!edited && rows.some((row) => row.id === campaign.id && row.status === 'SCHEDULED')) {
        edited = true;
        await prisma.siteAssociationCommunication.update({ where: { id: campaign.id }, data: { subject: 'Edited site subject', body: 'Edited site body', scheduledAt: new Date(Date.now() + 60_000) } });
      }
      return rows;
    } } } });
    const send = vi.fn();

    const result = await runDueScheduledMessages({ prisma: racing as typeof prisma, mailer: { send } }, new Date());

    expect(result).toEqual({ completed: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.siteAssociationCommunication.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ status: 'SCHEDULED', subject: 'Edited site subject', body: 'Edited site body' });
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
    const association = await prisma.memberAssociation.create({ data: { name: 'Restart Association', primaryContactName: 'Restart contact', primaryContactEmail: 'restart@example.test' } });
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
