import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createFakePaymentProvider } from '../../payments/fake';
import { confirmPayment } from '../../payments/webhook';
import { listReviewQueue } from '../../review/service';
import { signInAsNewAdmin } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

let app: ReturnType<typeof createApp>;
let registrationId: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  eventId = event.id;
  const reg = await prisma.registration.create({
    data: { ...registrationFixture(event.id), policyReference: 'x', parentEmailVerifiedAt: new Date(), checkoutSessionId: 'cs_1' },
  });
  registrationId = reg.id;
  app = createApp({ payment: createFakePaymentProvider() });
});

describe('stripe webhook', () => {
  it('rejects an invalid signature', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: { bad: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_signature');
  });
  it('marks a registration paid once, issues a QR, and is idempotent', async () => {
    const fake = { kind: 'checkout_completed' as const, stripeEventId: 'evt_paid_1', registrationId, sessionId: 'cs_1', amountCents: 3500, currency: 'aud', paymentStatus: 'paid' as const, paymentIntentId: 'pi_1' };
    const res1 = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    const res2 = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    expect(res1.json().status).toBe('ok');
    expect(res2.json().status).toBe('ok');
    const reg = await prisma.registration.findUnique({ where: { id: registrationId } });
    expect(reg?.status).toBe('PAID');
    expect(reg?.qrToken).toHaveLength(43);
    expect(reg?.paidAt).not.toBeNull();
    const confirmation = await prisma.emailLog.findFirstOrThrow({ where: { registrationId, kind: 'confirmation' } });
    expect(confirmation.status).toBe('SENT');
    expect(confirmation.batchId).toBe(`confirmation:${registrationId}`);
  });
  it('keeps a durable retryable confirmation record when Gmail delivery fails', async () => {
    app = createApp({
      payment: createFakePaymentProvider(),
      mailer: { send: async () => { throw new Error('Gmail unavailable'); } },
    });
    const fake = { kind: 'checkout_completed' as const, stripeEventId: 'evt_confirmation_retry', registrationId, sessionId: 'cs_1', amountCents: 3500, currency: 'aud', paymentStatus: 'paid' as const, paymentIntentId: 'pi_1' };
    const response = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    expect(response.statusCode).toBe(200);
    const confirmation = await prisma.emailLog.findFirstOrThrow({ where: { registrationId, kind: 'confirmation' } });
    expect(confirmation.status).toBe('AMBIGUOUS');
    expect(confirmation.messagePayload).toBeTruthy();
  });

  it('recovers a pending confirmation outbox without replaying payment', async () => {
    const result = await confirmPayment(prisma, {
      kind: 'checkout_completed', stripeEventId: 'evt_outbox_recovery', registrationId,
      sessionId: 'cs_1', amountCents: 3500, currency: 'aud', paymentStatus: 'paid', paymentIntentId: 'pi_recovery',
    }, new Date());
    expect(result?.outcome).toBe('paid');
    const pending = await prisma.emailLog.findFirstOrThrow({ where: { registrationId, kind: 'confirmation' } });
    expect(pending.status).toBe('PENDING');
    expect(pending.messagePayload).toBeNull();

    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const retried = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/messages/${pending.batchId}/retry`,
      cookies: { nt_session: cookie },
      payload: { deliveryIds: [pending.id] },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({ sent: 1, failed: 0 });
    const after = await prisma.emailLog.findUniqueOrThrow({ where: { id: pending.id } });
    expect(after.status).toBe('SENT');
    expect((after.messagePayload as any).inlineImages[0].cid).toBe('ticket-qr');
    expect((after.messagePayload as any).attachments[0].filename).toBe(`${registrationId}.ics`);
  });

  it.each(['EXPIRED', 'WITHDRAWN'] as const)('flags a settled payment for a %s registration for review without marking it paid', async (status) => {
    await prisma.registration.update({ where: { id: registrationId }, data: { status } });
    const fake = { kind: 'checkout_completed' as const, stripeEventId: `evt_orphan_${status}`, registrationId, sessionId: 'cs_1', amountCents: 3500, currency: 'aud', paymentStatus: 'paid' as const, paymentIntentId: 'pi_orphan' };
    const send = () => app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    const res = await send();
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('orphaned');
    expect((await send()).json().status).toBe('orphaned');

    const reg = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } });
    expect(reg.status).toBe(status);
    expect(reg.qrToken).toBeNull();
    expect(reg.paymentIntentId).toBeNull();
    expect(await prisma.emailLog.count({ where: { registrationId } })).toBe(0);
    expect((await prisma.processedStripeEvent.findUniqueOrThrow({ where: { stripeEventId: fake.stripeEventId } })).outcome).toBe('ORPHANED');
    const items = await prisma.reviewItem.findMany({ where: { registrationId } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ eventId, reason: 'payment_without_registration' });
    expect(items[0].note).toContain('pi_orphan');

    const queue = await listReviewQueue(prisma, eventId);
    expect(queue.map((item) => item.reason)).toEqual(['payment_without_registration']);
  });

  it('does not flag an unsettled completion for an expired registration', async () => {
    await prisma.registration.update({ where: { id: registrationId }, data: { status: 'EXPIRED' } });
    const result = await confirmPayment(prisma, {
      kind: 'checkout_completed', stripeEventId: 'evt_unpaid_expired', registrationId,
      sessionId: 'cs_1', amountCents: 3500, currency: 'aud', paymentStatus: 'unpaid', paymentIntentId: null,
    }, new Date());
    expect(result?.outcome).toBe('ignored');
    expect(await prisma.reviewItem.count()).toBe(0);
  });

  it('flags a settled payment for an amount that does not match without marking it paid', async () => {
    const fake = { kind: 'checkout_completed' as const, stripeEventId: 'evt_bad_amount', registrationId, sessionId: 'cs_1', amountCents: 999, currency: 'aud', paymentStatus: 'paid' as const, paymentIntentId: 'pi_1' };
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    expect(res.json().status).toBe('orphaned');
    expect((await prisma.registration.findUnique({ where: { id: registrationId } }))?.status).toBe('PENDING');
    const item = await prisma.reviewItem.findFirstOrThrow({ where: { registrationId } });
    expect(item.reason).toBe('payment_without_registration');
    expect(item.note).toContain('amount or currency did not match');
  });
});
