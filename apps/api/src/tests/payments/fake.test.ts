import { describe, it, expect } from 'vitest';
import { createFakePaymentProvider } from '../../payments/fake';

describe('fake payment provider', () => {
  it('keeps a stable opaque Checkout URL for the same idempotency key', async () => {
    const provider = createFakePaymentProvider();
    const request = {
      registrationId: 'r1', amountCents: 3500, currency: 'aud', productName: 'Trials',
      successUrl: 'https://app/success?session={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app/cancel', expiresAt: new Date(),
    };
    const session = await provider.createCheckout(request, 'r1');
    const retry = await provider.createCheckout(request, 'r1');
    expect(session.url).toMatch(/^https:\/\/checkout\.test\/fake_/);
    expect(session.url).not.toContain('r1');
    expect(retry).toEqual(session);
    expect(provider.checkouts).toHaveLength(1);
  });
});
