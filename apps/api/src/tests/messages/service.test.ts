import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createDevMailer } from '../../mail/dev-mailer';
import { GmailDeliveryError } from '../../mail/gmail-mailer';
import { reconcileStaleDeliveries, sendEventMessage, retryFailedDeliveries } from '../../messages/service';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);

async function paid(eventId: string, email: string, name: string) {
  return prisma.registration.create({
    data: registrationFixture(eventId, {
      playerFirstName: name,
      playerNameNormalized: name.toLowerCase(),
      parentEmail: email,
      status: 'PAID',
    }),
  });
}

describe('sendEventMessage delivery batches', () => {
  it('sends once per distinct paid address and records sender and batch per delivery', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'anne@example.com', 'Ada');
    await paid(event.id, 'anne@example.com', 'Bea');
    await paid(event.id, 'bo@example.com', 'Cy');
    await paid(event.id, 'withdrawn@example.com', 'Dee').then((row) =>
      prisma.registration.update({ where: { id: row.id }, data: { status: 'WITHDRAWN' } }),
    );
    const admin = await prisma.staffUser.create({ data: { email: 'sender@example.com' } });
    const mailer = createDevMailer([]);
    const sent = await sendEventMessage(
      { prisma, mailer }, event.id, { subject: 'Venue change', text: 'New court' }, new Date(),
      { batchId: 'batch-one', senderUserId: admin.id },
    );
    expect(sent).toMatchObject({ sent: 2, failed: 0, ambiguous: 0, batchId: 'batch-one' });
    const replay = await sendEventMessage(
      { prisma, mailer }, event.id, { subject: 'Venue change', text: 'New court' }, new Date(),
      { batchId: 'batch-one', senderUserId: admin.id },
    );
    expect(replay.sentThisRun).toBe(0);
    expect(mailer.sent.map((message) => message.to).sort()).toEqual(['anne@example.com', 'bo@example.com']);
    const rows = await prisma.emailLog.findMany({ where: { eventId: event.id }, orderBy: { to: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(['SENT', 'SENT']);
    expect(rows.every((row) => row.senderUserId === admin.id && row.batchId === 'batch-one' && row.sentAt !== null)).toBe(true);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2);
  });

  it('retries only known failed recipients and never resends confirmed successes', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'ok@example.com', 'Ada');
    await paid(event.id, 'retry@example.com', 'Bea');
    const admin = await prisma.staffUser.create({ data: { email: 'retry-admin@example.com' } });
    const sentTo: string[] = [];
    let failRetry = true;
    const mailer = { send: async (message: { to: string }) => {
      sentTo.push(message.to);
      if (message.to === 'retry@example.com' && failRetry) throw new GmailDeliveryError('Gmail rejected the message', 403);
    } };
    const first = await sendEventMessage({ prisma, mailer }, event.id, { subject: 'Update', text: 'Text' }, new Date(), { batchId: 'batch-retry', senderUserId: admin.id });
    const failed = await prisma.emailLog.findMany({ where: { batchId: 'batch-retry', status: 'FAILED' } });
    expect(first).toMatchObject({ sent: 1, failed: 1, ambiguous: 0 });
    failRetry = false;
    const retry = await retryFailedDeliveries({ prisma, mailer }, event.id, 'batch-retry', failed.map((row) => row.id), new Date());
    expect(retry).toMatchObject({ sent: 2, failed: 0, ambiguous: 0 });
    expect(sentTo.sort()).toEqual(['ok@example.com', 'retry@example.com', 'retry@example.com']);
    expect(await prisma.emailLog.count({ where: { batchId: 'batch-retry', status: 'SENT' } })).toBe(2);
    expect((await prisma.emailLog.findFirstOrThrow({ where: { batchId: 'batch-retry', to: 'retry@example.com' } })).attempts).toBe(2);
  });

  it('atomically claims a recipient when the same batch is dispatched concurrently', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'once@example.com', 'Ada');
    const mailer = createDevMailer([]);
    const args: Parameters<typeof sendEventMessage> = [
      { prisma, mailer }, event.id, { subject: 'One', text: 'Only once' }, new Date(), { batchId: 'batch-concurrent' },
    ];
    await Promise.all([sendEventMessage(...args), sendEventMessage(...args)]);
    expect(mailer.sent).toHaveLength(1);
    expect(await prisma.emailLog.count({ where: { batchId: 'batch-concurrent', status: 'SENT' } })).toBe(1);
  });

  it('requires explicit confirmation before retrying an ambiguous delivery', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'maybe@example.com', 'Ada');
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('connection lost after request'))
      .mockResolvedValue(undefined);
    const mailer = { send };
    const first = await sendEventMessage({ prisma, mailer }, event.id, { subject: 'Maybe', text: 'Text' }, new Date(), { batchId: 'batch-maybe' });
    const delivery = await prisma.emailLog.findFirstOrThrow({ where: { batchId: 'batch-maybe' } });
    expect(first.ambiguous).toBe(1);
    const noRetry = await retryFailedDeliveries({ prisma, mailer }, event.id, 'batch-maybe', [delivery.id], new Date());
    expect(send).toHaveBeenCalledTimes(1);
    expect(noRetry.ambiguous).toBe(1);
    const confirmedRetry = await retryFailedDeliveries({ prisma, mailer }, event.id, 'batch-maybe', [delivery.id], new Date(), { includeAmbiguous: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(confirmedRetry.sent).toBe(1);
  });

  it('moves an abandoned sending claim to ambiguous instead of retrying automatically', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const delivery = await prisma.emailLog.create({
      data: {
        eventId: event.id,
        batchId: 'abandoned-batch',
        idempotencyKey: 'abandoned-key',
        to: 'parent@example.com',
        subject: 'Pending',
        body: 'Pending',
        kind: 'message',
        status: 'SENDING',
        attempts: 1,
        lastAttemptAt: new Date('2026-10-09T00:00:00Z'),
      },
    });
    expect(await reconcileStaleDeliveries(prisma, new Date('2026-10-10T00:00:00Z'))).toBe(1);
    expect((await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('AMBIGUOUS');
  });

  it('records provider acceptance followed by a log-update failure as ambiguous', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    await paid(event.id, 'ambiguous@example.com', 'Ada');
    let failSentUpdate = true;
    const extended = prisma.$extends({
      query: {
        emailLog: {
          async updateMany({ args, query }) {
            if (args.data.status === 'SENT' && failSentUpdate) {
              failSentUpdate = false;
              throw new Error('database connection dropped after provider acceptance');
            }
            return query(args);
          },
        },
      },
    });
    const mailer = createDevMailer([]);
    const result = await sendEventMessage(
      { prisma: extended as any, mailer }, event.id, { subject: 'Maybe', text: 'Accepted externally' }, new Date(),
      { batchId: 'batch-ambiguous' },
    );
    expect(mailer.sent).toHaveLength(1);
    expect(result.ambiguous).toBe(1);
    expect((await prisma.emailLog.findFirstOrThrow({ where: { batchId: 'batch-ambiguous' } })).status).toBe('AMBIGUOUS');
  });
});
