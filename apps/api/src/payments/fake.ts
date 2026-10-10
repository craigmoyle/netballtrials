import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  WebhookEvent,
} from './provider';

export function createFakePaymentProvider(): PaymentProvider & {
  checkouts: CheckoutRequest[];
} {
  const checkouts: CheckoutRequest[] = [];

  return {
    checkouts,
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      checkouts.push(request);
      return {
        url: `https://checkout.test/${request.registrationId}`,
        sessionId: `fake_${checkouts.length}`,
      };
    },
    parseWebhook(rawBody: Buffer, signature: string): WebhookEvent {
      if (signature !== 'ok') {
        throw new Error('invalid signature');
      }
      try {
        const parsed = JSON.parse(rawBody.toString('utf8'));
        return parsed && ['checkout_completed', 'checkout_expired', 'checkout_failed'].includes(parsed.kind)
          ? (parsed as WebhookEvent)
          : { kind: 'ignored', stripeEventId: String(parsed?.stripeEventId ?? 'fake_ignored') };
      } catch {
        return { kind: 'ignored', stripeEventId: 'fake_malformed' };
      }
    },
  };
}
