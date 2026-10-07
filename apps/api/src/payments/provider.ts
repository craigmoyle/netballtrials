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

export type WebhookEvent =
  | {
      kind: 'checkout_completed';
      registrationId: string;
      sessionId: string;
      amountCents: number;
      paymentRef: string;
    }
  | { kind: 'ignored' };

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  parseWebhook(rawBody: Buffer, signature: string): WebhookEvent;
}
