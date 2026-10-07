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
        return { kind: 'ignored' };
      }
      try {
        const parsed = JSON.parse(rawBody.toString('utf8'));
        return parsed && parsed.kind === 'checkout_completed'
          ? (parsed as WebhookEvent)
          : { kind: 'ignored' };
      } catch {
        return { kind: 'ignored' };
      }
    },
  };
}
