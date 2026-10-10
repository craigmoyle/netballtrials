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
  const sessions = new Map<string, CheckoutSession>();

  return {
    checkouts,
    async createCheckout(request: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession> {
      const existing = sessions.get(idempotencyKey);
      if (existing) return existing;
      checkouts.push(request);
      const sessionId = `fake_${sessions.size + 1}`;
      const session = { url: `https://checkout.test/${sessionId}`, sessionId };
      sessions.set(idempotencyKey, session);
      return session;
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
