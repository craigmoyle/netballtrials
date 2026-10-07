import Stripe from 'stripe';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  WebhookEvent,
} from './provider';

export function createStripePaymentProvider(config: {
  secretKey: string;
  webhookSecret: string;
}): PaymentProvider {
  const stripe = new Stripe(config.secretKey);

  return {
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: request.registrationId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        expires_at: Math.floor(request.expiresAt.getTime() / 1000),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: request.currency,
              unit_amount: request.amountCents,
              product_data: { name: request.productName },
            },
          },
        ],
      });

      return { url: session.url ?? '', sessionId: session.id };
    },
    parseWebhook(rawBody: Buffer, signature: string): WebhookEvent {
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.webhookSecret,
      );

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          kind: 'checkout_completed',
          registrationId: String(session.client_reference_id ?? ''),
          sessionId: session.id,
          amountCents: session.amount_total ?? 0,
          paymentRef: String(session.payment_intent ?? session.id),
        };
      }

      return { kind: 'ignored' };
    },
  };
}
