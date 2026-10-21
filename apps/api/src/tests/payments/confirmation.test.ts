import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { confirmPayment } from '../../payments/webhook';
import { withdrawRegistration } from '../../registrations/service';
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
  it('creates a confirmation outbox row in the same payment transaction', async () => {
    const registration = await pending();
    const result = await confirmPayment(prisma, completed(registration.id), now);
    expect(result?.outcome).toBe('paid');
    const delivery = await prisma.emailLog.findFirstOrThrow({ where: { registrationId: registration.id, kind: 'confirmation' } });
    expect(delivery.status).toBe('PENDING');
    expect(delivery.batchId).toBe(`confirmation:${registration.id}`);
    expect(delivery.messagePayload).toBeNull();
  });

  it.each([
    ['wrong checkout session', { sessionId: 'cs_other' }, 'ignored'],
    ['wrong currency', { currency: 'usd' }, 'orphaned'],
    ['wrong amount', { amountCents: 1 }, 'orphaned'],
    ['unpaid Checkout session', { paymentStatus: 'unpaid' }, 'ignored'],
  ] as const)('does not settle a pending registration with %s', async (_label, overrides, outcome) => {
    const registration = await pending();
    const result = await confirmPayment(prisma, completed(registration.id, overrides), now);
    expect(result?.outcome).toBe(outcome);
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

  it('rechecks a real withdrawal that commits between the initial read and event lock', async () => {
    const registration = await pending();
    let withdrawn = false;
    const racing = prisma.$extends({ query: { registration: { async findUnique({ args, query }) {
      const snapshot = await query(args);
      if (!withdrawn && args.where.id === registration.id) {
        withdrawn = true;
        await withdrawRegistration(prisma, registration.eventId, registration.id, now);
      }
      return snapshot;
    } } } });
    expect((await confirmPayment(racing as typeof prisma, completed(registration.id), now))?.outcome).toBe('orphaned');
    expect((await confirmPayment(prisma, completed(registration.id), now))?.outcome).toBe('orphaned');
    expect(await prisma.reviewItem.count()).toBe(1);
    expect(await prisma.emailLog.count()).toBe(0);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: 'WITHDRAWN', qrToken: null });
  });

  it('rolls payment and the processed event back if the confirmation outbox cannot be written', async () => {
    const registration = await pending();
    const failing = prisma.$extends({ query: { emailLog: { async createMany() { throw new Error('outbox unavailable'); } } } });
    await expect(confirmPayment(failing as typeof prisma, completed(registration.id), now)).rejects.toThrow('outbox unavailable');
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: 'PENDING', qrToken: null });
    expect(await prisma.processedStripeEvent.count()).toBe(0);
    expect(await prisma.emailLog.count()).toBe(0);
    expect((await confirmPayment(prisma, completed(registration.id), now))?.outcome).toBe('paid');
    expect(await prisma.emailLog.count()).toBe(1);
  });

  it.each(['WITHDRAWN', 'EXPIRED'] as const)('records an orphan when %s wins after the pending read, including replay', async (status) => {
    const registration = await pending();
    let intervened = false;
    const racing = prisma.$extends({ query: { registration: { async updateMany({ args, query }) {
      if (args.data.status === 'PAID' && !intervened) {
        intervened = true;
        await prisma.registration.update({ where: { id: registration.id }, data: { status } });
      }
      return query(args);
    } } } });
    const event = completed(registration.id);
    expect((await confirmPayment(racing as typeof prisma, event, now))?.outcome).toBe('orphaned');
    expect((await confirmPayment(prisma, event, now))?.outcome).toBe('orphaned');
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status, qrToken: null });
    expect(await prisma.reviewItem.count({ where: { registrationId: registration.id, reason: 'payment_without_registration' } })).toBe(1);
    expect(await prisma.emailLog.count()).toBe(0);
    expect(await prisma.processedStripeEvent.findUniqueOrThrow({ where: { stripeEventId: event.stripeEventId } })).toMatchObject({ outcome: 'ORPHANED' });
  });

  it('classifies competing settled event IDs as paid/already paid and preserves both replay outcomes', async () => {
    const registration = await pending();
    const events = ['evt_first', 'evt_second'].map((stripeEventId) => completed(registration.id, { stripeEventId }));
    const outcomes = await Promise.all(events.map((event) => confirmPayment(prisma, event, now)));
    expect(outcomes.map((result) => result?.outcome).sort()).toEqual(['already_paid', 'paid']);
    for (const event of events) expect((await confirmPayment(prisma, event, now))?.outcome).toBe('already_paid');
    expect(await prisma.emailLog.count()).toBe(1);
    expect(await prisma.reviewItem.count()).toBe(0);
    expect(await prisma.processedStripeEvent.count()).toBe(2);
  });

  it('never revives a withdrawn registration on a signed payment replay', async () => {
    const registration = await pending({ status: 'WITHDRAWN' });
    const result = await confirmPayment(prisma, completed(registration.id), now);
    expect(result?.outcome).toBe('orphaned');
    const after = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(after.status).toBe('WITHDRAWN');
    expect(after.qrToken).toBeNull();
    expect(await prisma.reviewItem.count({ where: { registrationId: registration.id, reason: 'payment_without_registration' } })).toBe(1);
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
