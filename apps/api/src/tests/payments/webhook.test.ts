import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createFakePaymentProvider } from '../../payments/fake';
import { confirmPayment } from '../../payments/webhook';
import { signInAsNewAdmin } from '../helpers/auth';
import { resetDb } from '../helpers/db';

let app: ReturnType<typeof createApp>;
let registrationId: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  eventId = event.id;
  const reg = await prisma.registration.create({
    data: {
      eventId: event.id, playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
      dateOfBirth: new Date('2011-04-02T00:00:00Z'), parentName: 'Anne', parentEmail: 'anne@example.com',
      parentMobile: '0400000000', memberAssociation: 'MENA', rank1Position: 'GS', amountCents: 3500,
      policyReference: 'x', expiresAt: new Date(Date.now() + 86_400_000), checkoutSessionId: 'cs_1',
      eligibilityConfirmedAt: new Date('2026-08-01T00:00:00Z'), currency: 'aud',
    },
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

  it('ignores a payment for an amount that does not match', async () => {
    const fake = { kind: 'checkout_completed' as const, stripeEventId: 'evt_bad_amount', registrationId, sessionId: 'cs_1', amountCents: 999, currency: 'aud', paymentStatus: 'paid' as const, paymentIntentId: 'pi_1' };
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    expect(res.json().status).toBe('ignored');
    expect((await prisma.registration.findUnique({ where: { id: registrationId } }))?.status).toBe('PENDING');
  });
});

function eventFixture() {
  return {
    name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
    eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
    firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
    rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
  };
}
