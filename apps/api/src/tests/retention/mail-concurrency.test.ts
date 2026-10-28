import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../db';
import { createDevMailer } from '../../mail/dev-mailer';
import { reconcileStaleDeliveries, retryFailedDeliveries, sendEmailToRecipient, sendEventMessage } from '../../messages/service';
import { anonymizeExpiredRegistrations } from '../../retention/service';
import { confirmPayment } from '../../payments/webhook';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);
const beforeCutoff = new Date('2025-10-10T12:59:00Z');
const afterCutoff = new Date('2025-10-10T13:01:00Z');
const content = { subject: 'Private Ada details', text: 'Contact Anne', html: '<p>Private</p>' };

async function setup(status: 'PAID' | 'PENDING' = 'PAID') {
  const event = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2021-10-10T00:00:00Z') }) });
  const registration = await prisma.registration.create({ data: registrationFixture(event.id, { status, expiresAt: new Date('2026-10-12T00:00:00Z') }) });
  return { event, registration };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function wrap<T extends object>(object: T, overrides: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(object, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return overrides[property as keyof T];
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

describe('mail and retention share an event concurrency boundary', () => {
  it.each(['checkout', 'confirmation'])('does not recreate a %s log from a captured recipient after cleanup', async (kind) => {
    const { event, registration } = await setup(kind === 'checkout' ? 'PENDING' : 'PAID');
    expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(1);
    const mailer = createDevMailer([]);
    const result = await sendEmailToRecipient({ prisma, mailer }, {
      eventId: event.id, registrationId: registration.id, to: registration.parentEmail, kind, batchId: `captured:${kind}`,
    }, content, beforeCutoff);
    expect(result.sentThisRun).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.emailLog.count()).toBe(0);
  });

  it('serializes captured batch recipients with cleanup and refuses the stale dispatch without deadlocking', async () => {
    const { event } = await setup();
    let cleanup: Promise<number> | undefined;
    const registrations = (client: typeof prisma, inTransaction: boolean) => wrap(client.registration, {
      findMany: async (args: Parameters<typeof prisma.registration.findMany>[0]) => {
        const rows = await client.registration.findMany(args);
        if (args?.select?.parentEmail && !cleanup) {
          cleanup = anonymizeExpiredRegistrations(prisma, afterCutoff);
          // Legacy preparation has no transaction. The new protocol allows
          // cleanup to wait for preparation, then finishes before dispatch.
          if (!inTransaction) await cleanup;
        }
        return rows;
      },
    });
    const racing = wrap(prisma, {
      registration: registrations(prisma, false),
      $transaction: async (fn: (tx: typeof prisma) => Promise<unknown>) => {
        const result = await prisma.$transaction((tx) => fn(wrap(tx as typeof prisma, { registration: registrations(tx as typeof prisma, true) })));
        if (cleanup) await cleanup;
        return result;
      },
    });
    const mailer = createDevMailer([]);
    const result = await sendEventMessage({ prisma: racing, mailer }, event.id, content, beforeCutoff, { batchId: 'captured-batch' });
    expect(await cleanup).toBe(1);
    expect(result.sentThisRun).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    const logs = await prisma.emailLog.findMany();
    expect(logs.every((row) => row.status === 'ANONYMIZED' && row.to === '' && row.body === '' && row.messagePayload === null)).toBe(true);
    expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(0);
  });

  it.each([false, true])('defers cleanup until an active send completes (stale lease reconciled: %s)', async (reconcile) => {
    const { event, registration } = await setup();
    const entered = deferred();
    const release = deferred();
    const mailer = { send: vi.fn(async () => { entered.resolve(); await release.promise; }) };
    const sending = sendEventMessage({ prisma, mailer }, event.id, content, beforeCutoff, { batchId: 'active-send' });
    await entered.promise;
    try {
      if (reconcile) {
        expect(await reconcileStaleDeliveries(prisma, new Date(+afterCutoff + 20 * 60_000))).toBe(1);
        const row = await prisma.emailLog.findFirstOrThrow();
        await retryFailedDeliveries({ prisma, mailer: createDevMailer([]) }, event.id, row.batchId, [row.id], beforeCutoff, { includeAmbiguous: true });
      }
      expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(0);
      expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ anonymizedAt: null, parentEmail: 'anne@example.com' });
      expect(await prisma.emailLog.findFirstOrThrow()).toMatchObject({ to: 'anne@example.com' });
    } finally { release.resolve(); }
    expect((await sending).sentThisRun).toBe(1);
    expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(1);
    expect(await prisma.emailLog.findFirstOrThrow()).toMatchObject({ status: 'ANONYMIZED', to: '', messagePayload: null });
    expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(0);
  });

  it('does not recreate a webhook outbox from a registration captured before cleanup', async () => {
    const { registration } = await setup('PENDING');
    await prisma.registration.update({ where: { id: registration.id }, data: { checkoutSessionId: 'cs_retained' } });
    let cleaned = false;
    const racing = prisma.$extends({ query: { registration: { async findUnique({ args, query }) {
      const snapshot = await query(args);
      if (!cleaned && args.where.id === registration.id) {
        cleaned = true;
        expect(await anonymizeExpiredRegistrations(prisma, afterCutoff)).toBe(1);
      }
      return snapshot;
    } } } });
    const result = await confirmPayment(racing as typeof prisma, {
      kind: 'checkout_completed', stripeEventId: 'evt_retained', registrationId: registration.id,
      sessionId: 'cs_retained', amountCents: 3500, currency: 'aud', paymentStatus: 'paid', paymentIntentId: 'pi_retained',
    }, beforeCutoff);
    expect(result?.outcome).toBe('ignored');
    expect(await prisma.emailLog.count()).toBe(0);
    expect(await prisma.reviewItem.count()).toBe(0);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ anonymizedAt: afterCutoff, status: 'WITHDRAWN', parentEmail: '' });
  });

  it('refuses new preparation past the cutoff even before the cleanup job runs', async () => {
    const { event, registration } = await setup();
    const mailer = createDevMailer([]);
    await sendEventMessage({ prisma, mailer }, event.id, content, afterCutoff);
    await sendEmailToRecipient({ prisma, mailer }, { eventId: event.id, registrationId: registration.id, to: registration.parentEmail, kind: 'confirmation', batchId: 'too-late' }, content, afterCutoff);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.emailLog.count()).toBe(0);
  });
});
