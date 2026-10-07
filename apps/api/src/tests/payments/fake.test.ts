import { describe, it, expect } from 'vitest';
import { createFakePaymentProvider } from '../../payments/fake';

describe('fake payment provider', () => {
  it('records checkout requests and returns a local url', async () => {
    const provider = createFakePaymentProvider();
    const session = await provider.createCheckout({
      registrationId: 'r1', amountCents: 3500, currency: 'aud', productName: 'Trials',
      successUrl: 'https://app/success', cancelUrl: 'https://app/cancel', expiresAt: new Date(),
    });
    expect(session.url).toContain('r1');
    expect(provider.checkouts).toHaveLength(1);
  });
});
