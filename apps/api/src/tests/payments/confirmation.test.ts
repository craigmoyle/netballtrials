import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { confirmPayment } from '../../payments/webhook';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const now = new Date('2026-10-10T01:00:00Z');

beforeEach(resetDb);

async function pending(overrides: Record<string, unknown> = {}) {
  const event = await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) });
  const registration = await prisma.registration.create({
    data: registrationFixture(event.id, {
      status: 'PENDING',
      checkoutSessionId: 'cs_expected',
      amountCents: 3500,
      currency: 'aud',
      ...overrides,
    } as any),
  });
  return registration;
}

function completed(registrationId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'checkout_completed' as const,
    stripeEventId: 'evt_complete_1',
    registrationId,
    sessionId: 'cs_expected',
    amountCents: 3500,
    currency: 'aud',
    paymentStatus: 'paid',
    paymentIntentId: 'pi_settled',
    ...overrides,
  } as any;
}

describe('confirmPayment', () => {
  it.each([
    ['wrong checkout session', { sessionId: 'cs_other' }],
    ['wrong currency', { currency: 'usd' }],
    ['wrong amount', { amountCents: 1 }],
    ['unpaid Checkout session', { paymentStatus: 'unpaid' }],
  ])('does not settle a pending registration with %s', async (_label, overrides) => {
    const registration = await pending();
    const result = await confirmPayment(prisma, completed(registration.id, overrides), now);
    expect(result?.outcome).toBe('ignored');
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('PENDING');
  });

  it('applies one settled event once and preserves the issued QR on replay', async () => {
    const registration = await pending();
    const event = completed(registration.id);
    const first = await confirmPayment(prisma, event, now);
    const token = (await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).qrToken;
    const replay = await confirmPayment(prisma, event, new Date(now.getTime() + 1000));
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(first).toMatchObject({ registrationId: registration.id, outcome: 'paid' });
    expect(replay).toMatchObject({ registrationId: registration.id, outcome: 'already_paid' });
    expect(after.qrToken).toBe(token);
    expect(after.paymentIntentId).toBe('pi_settled');
    expect(await prisma.processedStripeEvent.count({ where: { stripeEventId: event.stripeEventId } })).toBe(1);
  });

  it('handles concurrent redelivery with a single state transition and token', async () => {
    const registration = await pending();
    const event = completed(registration.id);
    const outcomes = await Promise.all([
      confirmPayment(prisma, event, now),
      confirmPayment(prisma, event, new Date(now.getTime() + 1)),
    ]);
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(outcomes.filter((outcome) => outcome?.outcome === 'paid')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome?.outcome === 'already_paid')).toHaveLength(1);
    expect(after.status).toBe('PAID');
    expect(after.qrToken).toHaveLength(43);
    expect(await prisma.processedStripeEvent.count({ where: { stripeEventId: event.stripeEventId } })).toBe(1);
  });

  it('never revives a withdrawn registration on a signed payment replay', async () => {
    const registration = await pending({ status: 'WITHDRAWN' });
    const result = await confirmPayment(prisma, completed(registration.id), now);
    expect(result?.outcome).toBe('ignored');
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('WITHDRAWN');
    expect(after.qrToken).toBeNull();
  });

  it('expires only the registration belonging to the matching Checkout session', async () => {
    const registration = await pending();
    const event = {
      kind: 'checkout_expired',
      stripeEventId: 'evt_expired_1',
      registrationId: registration.id,
      sessionId: 'cs_other',
      amountCents: 3500,
      currency: 'aud',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
    } as any;
    await confirmPayment(prisma, event, now);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('PENDING');
    const matching = { ...event, stripeEventId: 'evt_expired_2', sessionId: 'cs_expected' };
    await confirmPayment(prisma, matching, now);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('EXPIRED');
  });
});
