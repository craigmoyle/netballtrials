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
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30', firstWhistle: '09:00' },
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

  it('uses event start time rather than first whistle for the due window', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30', firstWhistle: '09:00' },
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
});
