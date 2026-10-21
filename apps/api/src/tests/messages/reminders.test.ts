import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { sendDueReminders, eventStartInstant } from '../../messages/reminders';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { createDevMailer } from '../../mail/dev-mailer';
import { GmailDeliveryError } from '../../mail/gmail-mailer';

beforeEach(resetDb);

async function paid(eventId: string, email: string, name: string, overrides: Record<string, unknown> = {}) {
  return prisma.registration.create({
    data: registrationFixture(eventId, {
      playerFirstName: name,
      playerNameNormalized: name.toLowerCase(),
      parentEmail: email,
      status: 'PAID',
      checkedInAt: new Date('2026-09-12T08:00:00Z'),
      bibNumber: 1,
      ...overrides,
    }),
  });
}

describe('Melbourne event start and reminders', () => {
  it.each([
    ['AEST', '2026-09-12T00:00:00Z', '2026-09-11T22:30:00.000Z'],
    ['AEDT', '2026-12-12T00:00:00Z', '2026-12-11T21:30:00.000Z'],
  ])('converts the event start correctly in %s', (_label, date, expected) => {
    expect(eventStartInstant(new Date(date), '08:30').toISOString()).toBe(expected);
  });

  it('sends to distinct paid parents exactly at the 24-hour startTime boundary and is idempotent', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30', gameStartTime: '09:00' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    await paid(event.id, 'anne@example.com', 'Bea');
    await paid(event.id, 'bo@example.com', 'Cy');
    await paid(event.id, 'withdrawn@example.com', 'Dee', { status: 'WITHDRAWN' });
    const now = new Date('2026-09-10T22:30:00Z');
    const mailer = createDevMailer([]);
    const first = await sendDueReminders({ prisma, mailer }, now);
    expect(first).toMatchObject({ sent: 2, failed: 0, ambiguous: 0, events: 1 });
    expect(mailer.sent.map((message) => message.to).sort()).toEqual(['anne@example.com', 'bo@example.com']);
    const second = await sendDueReminders({ prisma, mailer }, new Date(now.getTime() + 60_000));
    expect(second.sent).toBe(0);
    expect(await prisma.emailLog.count({ where: { eventId: event.id, kind: 'reminder' } })).toBe(2);
  });

  it('tops up an existing reminder with newly paid addresses exactly once across concurrent runs', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'first@example.com', 'First');
    const later = await paid(event.id, 'later@example.com', 'Later', { status: 'PENDING' });
    const mailer = createDevMailer([]);
    const now = new Date('2026-09-10T22:30:00Z');
    expect((await sendDueReminders({ prisma, mailer }, now)).sent).toBe(1);
    await prisma.registration.update({ where: { id: later.id }, data: { status: 'PAID' } });
    await paid(event.id, 'LATER@example.com', 'Sibling');
    const results = await Promise.all([1, 2].map(() => sendDueReminders({ prisma, mailer }, new Date(+now + 60_000))));
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(results.every((result) => result.errors.length === 0)).toBe(true);
    expect(mailer.sent.map((message) => message.to).sort()).toEqual(['first@example.com', 'later@example.com']);
    expect(await prisma.emailLog.count({ where: { eventId: event.id, kind: 'reminder' } })).toBe(2);
    expect((await sendDueReminders({ prisma, mailer }, new Date(+now + 120_000))).sent).toBe(0);
  });

  it('does not top up a reminder with different content', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'first@example.com', 'First');
    const mailer = createDevMailer([]);
    const now = new Date('2026-09-10T22:30:00Z');
    await sendDueReminders({ prisma, mailer }, now);
    await prisma.event.update({ where: { id: event.id }, data: { venue: 'Changed' } });
    await paid(event.id, 'later@example.com', 'Later');
    await sendDueReminders({ prisma, mailer }, new Date(+now + 60_000));
    expect(mailer.sent).toHaveLength(1);
    expect(await prisma.emailLog.count()).toBe(1);
  });

  it('uses event arrival time rather than game start time for the due window', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30', gameStartTime: '09:00' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    const result = await sendDueReminders({ prisma, mailer: createDevMailer([]) }, new Date('2026-09-10T22:45:00Z'));
    expect(result.sent).toBe(1);
  });

  it('does not send before the 24-hour window opens', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    const result = await sendDueReminders({ prisma, mailer: createDevMailer([]) }, new Date('2026-09-10T22:29:59.999Z'));
    expect(result.sent).toBe(0);
  });

  it('retries only a known failed recipient without resending confirmed success', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    await paid(event.id, 'ok@example.com', 'Ada');
    await paid(event.id, 'retry@example.com', 'Bea');
    const sentTo: string[] = [];
    let fail = true;
    const mailer = { send: async (message: { to: string }) => {
      sentTo.push(message.to);
      if (message.to === 'retry@example.com' && fail) throw new GmailDeliveryError('rejected', 403);
    } };
    const now = new Date('2026-09-10T22:30:00Z');
    const first = await sendDueReminders({ prisma, mailer }, now);
    expect(first).toMatchObject({ sent: 1, failed: 1, ambiguous: 0 });
    fail = false;
    const retry = await sendDueReminders({ prisma, mailer }, new Date(now.getTime() + 60_000));
    expect(retry).toMatchObject({ sent: 1, failed: 0, ambiguous: 0 });
    expect(sentTo.sort()).toEqual(['ok@example.com', 'retry@example.com', 'retry@example.com']);
  });

  it('does not duplicate a reminder when two scheduled workers run together', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    const sentTo: string[] = [];
    const mailer = { send: async (message: { to: string }) => {
      sentTo.push(message.to);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } };
    const results = await Promise.all([
      sendDueReminders({ prisma, mailer }, new Date('2026-09-10T22:30:00Z')),
      sendDueReminders({ prisma, mailer }, new Date('2026-09-10T22:30:00Z')),
    ]);
    expect(sentTo).toEqual(['anne@example.com']);
    expect(await prisma.emailLog.count({ where: { eventId: event.id, kind: 'reminder', status: 'SENT' } })).toBe(1);
    expect(results.every((result) => result.failed === 0)).toBe(true);
  });

  it('does not claim or write deliveries during dry-run', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    const mailer = createDevMailer([]);
    const result = await sendDueReminders({ prisma, mailer }, new Date('2026-09-10T22:30:00Z'), { dryRun: true });
    expect(result).toMatchObject({ sent: 0, failed: 0, ambiguous: 0, events: 1 });
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.emailLog.count({ where: { eventId: event.id, kind: 'reminder' } })).toBe(0);
  });

  it('does not use a tomorrow subject during a same-day run', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30', name: 'Trials' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    const mailer = createDevMailer([]);
    await sendDueReminders({ prisma, mailer }, new Date('2026-09-11T22:00:00Z'));
    expect(mailer.sent[0].subject).not.toMatch(/tomorrow/i);
    expect(mailer.sent[0].text).toContain('Trials');
  });

  it('keeps going after one event has a conflicting reminder batch', async () => {
    const conflicted = await prisma.event.create({
      data: { ...eventFixture(), name: 'Conflicted', eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    const healthy = await prisma.event.create({
      data: { ...eventFixture(), name: 'Healthy', eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:00' },
    });
    await paid(conflicted.id, 'anne@example.com', 'Ada');
    await paid(healthy.id, 'bo@example.com', 'Bea');
    const batchId = `reminder:${conflicted.id}:2026-09-12`;
    await prisma.emailLog.create({
      data: { eventId: conflicted.id, batchId, idempotencyKey: 'old-reminder', to: 'anne@example.com', subject: 'Reminder: Old name', body: 'old', kind: 'reminder', status: 'SENT' },
    });
    const mailer = createDevMailer([]);
    const result = await sendDueReminders({ prisma, mailer }, new Date('2026-09-10T22:30:00Z'));
    expect(mailer.sent.map((message) => message.to)).toEqual(['bo@example.com']);
    expect(result).toMatchObject({ sent: 1, failed: 0, events: 2, errors: [] });
  });

  it('reports an edited reminder batch that still has unsent rows', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), name: 'Edited', eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    await prisma.emailLog.create({
      data: { eventId: event.id, batchId: `reminder:${event.id}:2026-09-12`, idempotencyKey: 'old-failed', to: 'anne@example.com', subject: 'Reminder: Old name', body: 'old', kind: 'reminder', status: 'FAILED' },
    });
    const result = await sendDueReminders({ prisma, mailer: createDevMailer([]) }, new Date('2026-09-10T22:30:00Z'));
    expect(result.errors).toEqual([{ eventId: event.id, message: 'reminder_changed_with_1_unsent' }]);
  });

  it('counts an unexpected per-event error as failed and still sends other events', async () => {
    const first = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    const second = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:00' },
    });
    await paid(first.id, 'anne@example.com', 'Ada');
    await paid(second.id, 'bo@example.com', 'Bea');
    let fail = true;
    const extended = prisma.$extends({ query: { emailLog: { async createMany({ args, query }) {
      if (fail) { fail = false; throw new Error('database blip'); }
      return query(args);
    } } } });
    const mailer = createDevMailer([]);
    const result = await sendDueReminders({ prisma: extended as typeof prisma, mailer }, new Date('2026-09-10T22:30:00Z'));
    expect(result).toMatchObject({ sent: 1, failed: 1, events: 2 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('database blip');
    expect(mailer.sent).toHaveLength(1);
  });

  it('stops retrying a failed reminder automatically after five attempts', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30' },
    });
    await paid(event.id, 'anne@example.com', 'Ada');
    const sentTo: string[] = [];
    const mailer = { send: async (message: { to: string }) => {
      sentTo.push(message.to);
      throw new GmailDeliveryError('rejected', 403);
    } };
    const start = new Date('2026-09-10T22:30:00Z').getTime();
    for (let run = 0; run < 7; run += 1) {
      await sendDueReminders({ prisma, mailer }, new Date(start + run * 60_000));
    }
    expect(sentTo).toHaveLength(5);
    const row = await prisma.emailLog.findFirstOrThrow({ where: { eventId: event.id, kind: 'reminder' } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5 });
  });
});
