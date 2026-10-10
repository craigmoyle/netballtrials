import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createStripePaymentProvider } from '../../payments/stripe';

const webhookSecret = 'whsec_review_test';
const provider = createStripePaymentProvider({ secretKey: 'sk_test_review', webhookSecret });

function signedEvent(
  object: Record<string, unknown>,
  type = 'checkout.session.completed',
  id = 'evt_review_1',
) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    data: { object: { object: 'checkout.session', ...object } },
  });
  return {
    body: Buffer.from(payload),
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }),
  };
}

const session = {
  id: 'cs_expected',
  client_reference_id: 'registration-1',
  amount_total: 3500,
  currency: 'aud',
  payment_status: 'paid',
  payment_intent: 'pi_settled',
};

describe('Stripe webhook adapter', () => {
  it('preserves event, checkout, amount, currency, settlement and intent identities', () => {
    const signed = signedEvent(session);
    expect(provider.parseWebhook(signed.body, signed.signature)).toEqual({
      kind: 'checkout_completed',
      stripeEventId: 'evt_review_1',
      registrationId: 'registration-1',
      sessionId: 'cs_expected',
      amountCents: 3500,
      currency: 'aud',
      paymentStatus: 'paid',
      paymentIntentId: 'pi_settled',
    });
  });

  it('preserves unpaid completion for the service to reject', () => {
    const signed = signedEvent({ ...session, payment_status: 'unpaid', payment_intent: null });
    expect(provider.parseWebhook(signed.body, signed.signature)).toMatchObject({
      kind: 'checkout_completed',
      paymentStatus: 'unpaid',
      paymentIntentId: null,
    });
  });

  it('recognises checkout expiry as a state transition, not a completion', () => {
    const signed = signedEvent({ ...session, status: 'expired' }, 'checkout.session.expired', 'evt_expired');
    expect(provider.parseWebhook(signed.body, signed.signature)).toMatchObject({
      kind: 'checkout_expired',
      stripeEventId: 'evt_expired',
      registrationId: 'registration-1',
      sessionId: 'cs_expected',
    });
  });

  it('ignores unrelated signed Stripe events while retaining the event ID', () => {
    const signed = signedEvent({}, 'customer.created', 'evt_other');
    expect(provider.parseWebhook(signed.body, signed.signature)).toEqual({
      kind: 'ignored',
      stripeEventId: 'evt_other',
    });
  });
});
