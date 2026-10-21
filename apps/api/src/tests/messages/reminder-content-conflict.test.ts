import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { createDevMailer } from '../../mail/dev-mailer';
import { sendDueReminders } from '../../messages/reminders';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);
const now = new Date('2026-09-10T22:30:00Z');

describe('changed reminder content', () => {
  it.each(['SENT', 'FAILED'] as const)('reports omitted paid households even when existing rows are %s, without changing or sending old content', async (status) => {
    const event = await prisma.event.create({ data: eventFixture() });
    await prisma.registration.create({ data: registrationFixture(event.id, { status: 'PAID' }) });
    const mailer = createDevMailer([]);
    expect((await sendDueReminders({ prisma, mailer }, now)).sent).toBe(1);
    const original = await prisma.emailLog.findFirstOrThrow();
    await prisma.emailLog.update({ where: { id: original.id }, data: { status } });
    await prisma.event.update({ where: { id: event.id }, data: { venue: 'New venue' } });
    const later = await prisma.registration.create({ data: registrationFixture(event.id, { status: 'PAID', parentEmail: 'later@example.com', playerNameNormalized: 'later', createdAt: now }) });
    await prisma.registration.createMany({ data: [
      registrationFixture(event.id, { status: 'PAID', parentEmail: ' LATER@example.com ' }),
      registrationFixture(event.id, { status: 'PAID', parentEmail: ' ANNE@example.com ' }),
      registrationFixture(event.id, { status: 'PAID', parentEmail: ' ' }),
      registrationFixture(event.id, { status: 'PENDING', parentEmail: 'pending@example.com' }),
      registrationFixture(event.id, { status: 'WITHDRAWN', parentEmail: 'withdrawn@example.com' }),
      registrationFixture(event.id, { status: 'PAID', parentEmail: 'retained@example.com', anonymizedAt: now }),
    ].map((registration, index) => ({ ...registration, playerNameNormalized: `other ${index}` })) });

    const result = await sendDueReminders({ prisma, mailer }, new Date(+now + 60_000));
    expect(result).toMatchObject({ sent: 0, failed: 0, ambiguous: 0 });
    const omission = result.errors.find((error) => error.message.startsWith('reminder_changed_with_1_omitted:'));
    expect(omission).toMatchObject({ eventId: event.id });
    expect(omission?.message).toContain(later.id);
    expect(omission?.message).toContain('Send an updated message manually');
    expect(omission?.message).not.toContain('later@example.com');
    expect(result.errors).toHaveLength(status === 'SENT' ? 1 : 2);
    if (status === 'FAILED') expect(result.errors).toContainEqual({ eventId: event.id, message: 'reminder_changed_with_1_unsent' });
    expect(mailer.sent).toHaveLength(1);
    expect(await prisma.emailLog.findMany()).toEqual([{ ...original, status, updatedAt: expect.any(Date) }]);
    expect((await sendDueReminders({ prisma, mailer }, new Date(+now + 120_000))).errors).toEqual(result.errors);
  });
});
