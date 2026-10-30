import { randomUUID } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  WebhookEvent,
} from './provider';

export function createFakePaymentProvider(): PaymentProvider & {
  checkouts: CheckoutRequest[];
  expiredCheckouts: string[];
} {
  const checkouts: CheckoutRequest[] = [];
  const expiredCheckouts: string[] = [];
  const sessions = new Map<string, { checkout: CheckoutSession; status: 'OPEN' | 'EXPIRED' | 'COMPLETE' }>();

  return {
    checkouts,
    expiredCheckouts,
    async createCheckout(request: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession> {
      const existing = sessions.get(idempotencyKey);
      if (existing) return existing.checkout;
      checkouts.push(request);
      const sessionId = `fake_${randomUUID()}`;
      const checkout = { url: `https://checkout.test/${sessionId}`, sessionId };
      sessions.set(idempotencyKey, { checkout, status: 'OPEN' });
      return checkout;
    },
    async expireCheckout(sessionId: string): Promise<boolean> {
      const record = [...sessions.values()].find((session) => session.checkout.sessionId === sessionId);
      if (!record || record.status === 'COMPLETE') return false;
      record.status = 'EXPIRED';
      if (!expiredCheckouts.includes(sessionId)) expiredCheckouts.push(sessionId);
      return true;
    },
    async completeLocalCheckout(sessionId: string): Promise<boolean> {
      const record = [...sessions.values()].find((session) => session.checkout.sessionId === sessionId);
      if (!record || record.status === 'EXPIRED') return false;
      record.status = 'COMPLETE';
      return true;
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
