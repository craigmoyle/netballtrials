import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AppDeps } from '../app';
import { generateToken } from '../auth/tokens';
import { sendConfirmation } from '../registrations/confirmation';
import type { WebhookEvent } from './provider';

export type PaymentOutcome = 'paid' | 'already_paid' | 'expired' | 'failed' | 'ignored';

export type PaymentConfirmationResult = {
  registrationId: string;
  outcome: PaymentOutcome;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { code?: string }).code === 'P2002';
}

export async function confirmPayment(
  prisma: PrismaClient,
  event: WebhookEvent,
  now: Date,
): Promise<PaymentConfirmationResult | null> {
  if (event.kind === 'ignored') return null;

  try {
    return await prisma.$transaction(async (tx) => {
      const claimedEvent = await tx.processedStripeEvent.createMany({
        data: [{
          stripeEventId: event.stripeEventId,
          eventType: event.kind,
          outcome: 'PROCESSING',
        }],
        skipDuplicates: true,
      });

      if (claimedEvent.count === 0) {
        const existing = await tx.processedStripeEvent.findUnique({
          where: { stripeEventId: event.stripeEventId },
        });
        return {
          registrationId: event.registrationId,
          outcome: existing?.outcome === 'PAID' ? 'already_paid' :
            existing?.outcome === 'EXPIRED' ? 'expired' :
              existing?.outcome === 'FAILED' ? 'failed' : 'ignored',
        };
      }

      const registration = await tx.registration.findUnique({
        where: { id: event.registrationId },
      });

      let outcome: PaymentOutcome = 'ignored';
      if (
        registration &&
        registration.status === 'PENDING' &&
        registration.checkoutSessionId === event.sessionId
      ) {
        if (event.kind === 'checkout_completed') {
          const isSettled = event.paymentStatus === 'paid' ||
            (event.paymentStatus === 'no_payment_required' && event.amountCents === 0);
          const amountMatches = registration.amountCents === event.amountCents;
          const currencyMatches = registration.currency.toLowerCase() === event.currency.toLowerCase();

          if (isSettled && amountMatches && currencyMatches) {
            const claimedRegistration = await tx.registration.updateMany({
              where: {
                id: registration.id,
                status: 'PENDING',
                checkoutSessionId: event.sessionId,
                amountCents: event.amountCents,
                currency: registration.currency,
              },
              data: {
                status: 'PAID',
                paidAt: now,
                paymentIntentId: event.paymentIntentId,
                qrToken: generateToken(),
              },
            });
            if (claimedRegistration.count === 1) {
              outcome = 'paid';
            }
          }
        } else {
          const status = event.kind === 'checkout_expired' ? 'EXPIRED' : 'FAILED';
          const claimedRegistration = await tx.registration.updateMany({
            where: {
              id: registration.id,
              status: 'PENDING',
              checkoutSessionId: event.sessionId,
            },
            data: { status },
          });
          if (claimedRegistration.count === 1) {
            outcome = event.kind === 'checkout_expired' ? 'expired' : 'failed';
          }
        }
      } else if (
        registration?.status === 'PAID' &&
        registration.checkoutSessionId === event.sessionId
      ) {
        outcome = 'already_paid';
      }

      await tx.processedStripeEvent.update({
        where: { stripeEventId: event.stripeEventId },
        data: { outcome: outcome.toUpperCase() },
      });
      return { registrationId: event.registrationId, outcome };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent duplicate may win before PostgreSQL applies ON CONFLICT.
      const existing = await prisma.processedStripeEvent.findUnique({
        where: { stripeEventId: event.stripeEventId },
      });
      if (existing) {
        return {
          registrationId: event.registrationId,
          outcome: existing.outcome === 'PAID' ? 'already_paid' :
            existing.outcome === 'EXPIRED' ? 'expired' :
              existing.outcome === 'FAILED' ? 'failed' : 'ignored',
        };
      }
    }
    throw error;
  }
}

export function registerStripeWebhookRoute(app: FastifyInstance, deps: AppDeps): void {
  // Scoped raw-body parser so the signature sees the exact bytes. Other scopes
  // keep Fastify's normal JSON parsing.
  app.register(async (instance) => {
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body);
      },
    );

    instance.post('/api/webhooks/stripe', async (req, reply) => {
      const signature = String(req.headers['stripe-signature'] ?? '');
      if (!signature) {
        return reply.code(400).send({ error: 'invalid_signature' });
      }

      let event: WebhookEvent;
      try {
        event = deps.payment.parseWebhook(req.body as Buffer, signature);
      } catch {
        return reply.code(400).send({ error: 'invalid_signature' });
      }

      const result = await confirmPayment(deps.prisma, event, new Date());
      if (!result || result.outcome === 'ignored') {
        return reply.code(200).send({ status: 'ignored' });
      }
      if (result.outcome === 'already_paid') {
        return reply.code(200).send({ status: 'ok' });
      }
      if (result.outcome !== 'paid') {
        return reply.code(200).send({ status: result.outcome });
      }

      const registration = await deps.prisma.registration.findUnique({
        where: { id: result.registrationId },
        include: { event: true },
      });

      if (registration?.qrToken) {
        const ticketUrl = `${deps.env.API_PUBLIC_URL}/api/public/ticket/${registration.qrToken}`;
        try {
          await sendConfirmation(deps, registration, registration.event, ticketUrl);
        } catch {
          // Delivery is made durable/retryable by the Gmail delivery workstream.
        }
      }

      return reply.code(200).send({ status: 'ok' });
    });
  });
}
