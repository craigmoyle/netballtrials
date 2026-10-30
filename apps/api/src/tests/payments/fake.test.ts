import { describe, it, expect } from 'vitest';
import { createFakePaymentProvider } from '../../payments/fake';

describe('fake payment provider', () => {
  it('expires an open Checkout session idempotently', async () => {
    const provider = createFakePaymentProvider();
    const session = await provider.createCheckout({
      registrationId: 'r1', amountCents: 3500, currency: 'aud', productName: 'Trials',
      successUrl: 'https://app/success', cancelUrl: 'https://app/cancel', expiresAt: new Date(),
    }, 'r1');

    expect(await provider.expireCheckout(session.sessionId)).toBe(true);
    expect(await provider.expireCheckout(session.sessionId)).toBe(true);
    expect(await provider.completeLocalCheckout?.(session.sessionId)).toBe(false);
    expect(provider.expiredCheckouts).toEqual([session.sessionId]);
    expect(await provider.expireCheckout('unknown')).toBe(false);
  });

  it('keeps a stable opaque Checkout URL for the same idempotency key', async () => {
    const provider = createFakePaymentProvider();
    const request = {
      registrationId: 'r1', amountCents: 3500, currency: 'aud', productName: 'Trials',
      successUrl: 'https://app/success?session={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app/cancel', expiresAt: new Date(),
    };
    const session = await provider.createCheckout(request, 'r1');
    const retry = await provider.createCheckout(request, 'r1');
    const other = await provider.createCheckout({ ...request, registrationId: 'r2' }, 'r2');
    expect(session.url).toMatch(/^https:\/\/checkout\.test\/fake_/);
    expect(session.sessionId).toMatch(/^fake_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(session.url).not.toContain('r1');
    expect(retry).toEqual(session);
    expect(other.sessionId).not.toBe(session.sessionId);
    expect(other.sessionId).not.toContain('r2');
    expect(provider.checkouts).toHaveLength(2);
  });
});
