import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createDevMailer } from '../../mail/dev-mailer';
import { sendDueReminders } from '../../messages/reminders';
import { eventFixture } from '../helpers/fixtures';
import { seedPaidFlagged } from '../helpers/review';

beforeEach(resetDb);

describe('sendDueReminders', () => {
  it('sends once per event inside the window and is idempotent', async () => {
    const event = await prisma.event.create({
      data: {
        ...eventFixture(),
        eventDate: new Date('2026-09-12T00:00:00Z'),
        firstWhistle: '09:00',
      },
    });
    await seedPaidFlagged(event.id);
    const now = new Date('2026-09-11T01:00:00Z'); // 8 hours before the 09:00 first whistle
    const mailer = createDevMailer([]);
    const first = await sendDueReminders({ prisma, mailer }, now);
    expect(first.sent).toBe(1);
    const second = await sendDueReminders({ prisma, mailer }, new Date(now.getTime() + 60_000));
    expect(second.sent).toBe(0);
    expect(await prisma.emailLog.count({ where: { kind: 'reminder' } })).toBe(1);
  });
  it('ignores events outside the window', async () => {
    const event = await prisma.event.create({
      data: { ...eventFixture(), eventDate: new Date('2026-09-20T00:00:00Z') },
    });
    await seedPaidFlagged(event.id);
    const mailer = createDevMailer([]);
    expect(
      (await sendDueReminders({ prisma, mailer }, new Date('2026-09-11T01:00:00Z'))).sent,
    ).toBe(0);
  });
});
