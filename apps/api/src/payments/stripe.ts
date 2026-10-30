import Stripe from 'stripe';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  WebhookEvent,
} from './provider';

type StripeCheckoutSessionOperations = {
  expire(sessionId: string): Promise<{ status: string | null }>;
  retrieve(sessionId: string): Promise<{ status: string | null }>;
};

export async function expireStripeCheckout(
  sessions: StripeCheckoutSessionOperations,
  sessionId: string,
): Promise<boolean> {
  try {
    const expired = await sessions.expire(sessionId);
    return expired.status === 'expired';
  } catch (error) {
    const current = await sessions.retrieve(sessionId);
    if (current.status === 'expired') return true;
    if (current.status === 'complete') return false;
    throw error;
  }
}

export function createStripePaymentProvider(config: {
  secretKey: string;
  webhookSecret: string;
}): PaymentProvider {
  const stripe = new Stripe(config.secretKey);

  return {
    async createCheckout(request: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession> {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        // Card only: delayed methods (e.g. BECS debit) can settle after the
        // registration hold has expired.
        allowed_payment_method_types: ['card'],
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
      }, { idempotencyKey });

      return { url: session.url ?? '', sessionId: session.id };
    },
    expireCheckout: (sessionId) => expireStripeCheckout(stripe.checkout.sessions, sessionId),
    parseWebhook(rawBody: Buffer, signature: string): WebhookEvent {
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.webhookSecret,
      );

      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        const session = event.data.object as Stripe.Checkout.Session;
        const paymentIntent = session.payment_intent;
        return {
          kind: 'checkout_completed',
          stripeEventId: event.id,
          registrationId: session.client_reference_id ?? '',
          sessionId: session.id,
          amountCents: session.amount_total ?? 0,
          currency: (session.currency ?? '').toLowerCase(),
          paymentStatus:
            session.payment_status === 'paid'
              ? 'paid'
              : session.payment_status === 'no_payment_required'
                ? 'no_payment_required'
                : 'unpaid',
          paymentIntentId:
            typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id ?? null,
        };
      }

      if (event.type === 'checkout.session.expired') {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          kind: 'checkout_expired',
          stripeEventId: event.id,
          registrationId: session.client_reference_id ?? '',
          sessionId: session.id,
        };
      }

      if (event.type === 'checkout.session.async_payment_failed') {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          kind: 'checkout_failed',
          stripeEventId: event.id,
          registrationId: session.client_reference_id ?? '',
          sessionId: session.id,
        };
      }

      return { kind: 'ignored', stripeEventId: event.id };
    },
  };
}
