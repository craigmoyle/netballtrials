export interface CheckoutRequest {
  registrationId: string;
  amountCents: number;
  currency: string;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface CheckoutSession {
  url: string;
  sessionId: string;
}

interface CheckoutEventBase {
  stripeEventId: string;
  registrationId: string;
  sessionId: string;
}

export type WebhookEvent =
  | (CheckoutEventBase & {
      kind: 'checkout_completed';
      amountCents: number;
      currency: string;
      paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
      paymentIntentId: string | null;
    })
  | (CheckoutEventBase & { kind: 'checkout_expired' | 'checkout_failed' })
  | { kind: 'ignored'; stripeEventId: string };

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession>;
  /** Expire an open Checkout session. Returns false when it has already completed. */
  expireCheckout(sessionId: string): Promise<boolean>;
  /** Local-only fake provider hook to prevent completing an expired test session. */
  completeLocalCheckout?(sessionId: string): Promise<boolean>;
  parseWebhook(rawBody: Buffer, signature: string): WebhookEvent;
}
