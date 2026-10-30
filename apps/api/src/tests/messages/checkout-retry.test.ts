import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '../../app';
import { prisma } from '../../db';
import { loadEnv } from '../../env';
import { createDevMailer } from '../../mail/dev-mailer';
import { GmailDeliveryError } from '../../mail/gmail-mailer';
import { retryPendingCheckouts } from '../../messages/checkout-retry';
import { sendEmailToRecipient } from '../../messages/service';
import { createFakePaymentProvider } from '../../payments/fake';
import { sendCheckoutContinuation } from '../../registrations/checkout';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(resetDb);
const now = new Date('2026-10-10T01:00:00Z');
const old = new Date(+now - 10 * 60_000);

describe('retryPendingCheckouts', () => {
  it('recovers an OAuth failure for the verified current address with no new provider session', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const registration = await prisma.registration.create({ data: registrationFixture(event.id) });
    const send = vi.fn().mockRejectedValueOnce(new GmailDeliveryError('OAuth failed', undefined, { notSent: true })).mockResolvedValue(undefined);
    const payment = createFakePaymentProvider();
    const deps = { prisma, payment, mailer: { send }, env: loadEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'fake' }) } satisfies AppDeps;
    expect(await sendCheckoutContinuation(deps, registration)).toBe(false);
    const row = await prisma.emailLog.findFirstOrThrow();
    await prisma.emailLog.update({ where: { id: row.id }, data: { createdAt: old } });
    const original = send.mock.calls[0][0];
    const result = await retryPendingCheckouts(deps, now);
    expect(result).toEqual({ due: 1, sent: 1, failed: 0, ambiguous: 0, errors: 0 });
    expect(send.mock.calls[1][0]).toEqual(original);
    expect(payment.checkouts).toHaveLength(1);
    expect((await retryPendingCheckouts(deps, now)).due).toBe(0);
  });

  it('selects only old known-unsent, eligible checkout rows; dry-run changes nothing and retries are capped', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const variants = ['pending', 'failed', 'paid', 'expired', 'withdrawn', 'anonymized', 'ambiguous', 'sending', 'sent', 'capped', 'fresh'] as const;
    for (const variant of variants) {
      const registration = await prisma.registration.create({ data: registrationFixture(event.id, {
        playerNameNormalized: variant, parentEmail: `${variant}@example.com`,
        status: variant === 'paid' ? 'PAID' : variant === 'withdrawn' ? 'WITHDRAWN' : 'PENDING',
        expiresAt: new Date(+now + (variant === 'expired' ? -1 : 86_400_000)),
        anonymizedAt: variant === 'anonymized' ? old : null,
      }) });
      await prisma.emailLog.create({ data: {
        eventId: event.id, registrationId: registration.id, batchId: `checkout:${variant}`, idempotencyKey: variant,
        kind: 'checkout', to: registration.parentEmail, subject: 'Continue', body: 'https://checkout.test/original', messagePayload: {},
        status: variant === 'ambiguous' ? 'AMBIGUOUS' : variant === 'sending' ? 'SENDING' : variant === 'sent' ? 'SENT' : variant === 'failed' || variant === 'capped' ? 'FAILED' : 'PENDING',
        attempts: variant === 'capped' ? 5 : 0, createdAt: variant === 'fresh' ? now : old,
      } });
    }
    const before = await prisma.emailLog.findMany({ orderBy: { id: 'asc' } });
    const mailer = createDevMailer([]);
    expect(await retryPendingCheckouts({ prisma, mailer }, now, { dryRun: true })).toEqual({ due: 2, sent: 0, failed: 0, ambiguous: 0, errors: 0 });
    expect(await prisma.emailLog.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(mailer.sent).toHaveLength(0);
    const send = vi.fn().mockRejectedValue(new GmailDeliveryError('OAuth failed', undefined, { notSent: true }));
    for (let run = 0; run < 7; run++) await retryPendingCheckouts({ prisma, mailer: { send } }, now);
    expect(send).toHaveBeenCalledTimes(10);
    expect((await prisma.emailLog.findMany({ where: { idempotencyKey: { in: ['pending', 'failed'] } } })).every((row) => row.attempts === 5 && row.status === 'FAILED')).toBe(true);
  });

  it('does not create checkout/confirmation logs for the wrong current registration status', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const pending = await prisma.registration.create({ data: registrationFixture(event.id, { expiresAt: new Date(+now + 86_400_000) }) });
    const mailer = createDevMailer([]);
    const delivery = { eventId: event.id, registrationId: pending.id, to: pending.parentEmail };
    await sendEmailToRecipient({ prisma, mailer }, { ...delivery, kind: 'confirmation', batchId: 'unpaid-ticket' }, { subject: 'Ticket', text: 'Secret QR' }, now);
    await prisma.registration.update({ where: { id: pending.id }, data: { status: 'PAID' } });
    await sendEmailToRecipient({ prisma, mailer }, { ...delivery, kind: 'checkout', batchId: 'paid-checkout' }, { subject: 'Pay', text: 'Secret link' }, now);
    expect(mailer.sent).toHaveLength(0);
    expect(await prisma.emailLog.count()).toBe(0);
  });
});
