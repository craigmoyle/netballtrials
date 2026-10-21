import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AppDeps } from '../app';
import { generateToken } from '../auth/tokens';
import { sendConfirmation } from '../registrations/confirmation';
import { deliveryIdempotencyKey } from '../messages/service';
import { lockMailEvent } from '../mail/lifecycle';
import { isPastRetentionCutoff } from '../retention/service';
import type { WebhookEvent } from './provider';

export type PaymentOutcome = 'paid' | 'already_paid' | 'expired' | 'failed' | 'orphaned' | 'ignored';

export const ORPHANED_PAYMENT_REVIEW_REASON = 'payment_without_registration';

export type PaymentConfirmationResult = {
  registrationId: string;
  outcome: PaymentOutcome;
};

function storedOutcome(outcome: string | undefined): PaymentOutcome {
  return outcome === 'PAID' || outcome === 'ALREADY_PAID' ? 'already_paid' :
    outcome === 'EXPIRED' ? 'expired' :
      outcome === 'FAILED' ? 'failed' :
        outcome === 'ORPHANED' ? 'orphaned' : 'ignored';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { code?: string }).code === 'P2002';
}

function isSettledPayment(event: Extract<WebhookEvent, { kind: 'checkout_completed' }>): boolean {
  return event.paymentStatus === 'paid' ||
    (event.paymentStatus === 'no_payment_required' && event.amountCents === 0);
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
        return { registrationId: event.registrationId, outcome: storedOutcome(existing?.outcome) };
      }

      let registration = await tx.registration.findUnique({
        where: { id: event.registrationId },
      });
      const mailEvent = registration ? await lockMailEvent(tx, registration.eventId) : null;
      // Retention/withdrawal may have won while we waited for the Event lock.
      if (registration) registration = await tx.registration.findUnique({ where: { id: registration.id } });

      let outcome: PaymentOutcome = 'ignored';
      if (
        registration &&
        registration.status === 'PENDING' &&
        registration.checkoutSessionId === event.sessionId
      ) {
        if (event.kind === 'checkout_completed') {
          const isSettled = isSettledPayment(event);
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
              const batchId = `confirmation:${registration.id}`;
              if (mailEvent && !isPastRetentionCutoff(mailEvent.eventDate, now)) await tx.emailLog.createMany({
                skipDuplicates: true,
                data: [{
                  eventId: registration.eventId,
                  registrationId: registration.id,
                  batchId,
                  idempotencyKey: deliveryIdempotencyKey(batchId, registration.parentEmail),
                  to: registration.parentEmail,
                  subject: 'Registration confirmation',
                  body: '',
                  kind: 'confirmation',
                  status: 'PENDING',
                }],
              });
              outcome = 'paid';
            } else {
              const current = await tx.registration.findUnique({ where: { id: registration.id } });
              if (current?.checkoutSessionId === event.sessionId && !current.anonymizedAt) {
                if (current.status === 'PAID') outcome = 'already_paid';
                else if (current.status !== 'PENDING') {
                  await flagOrphanedPayment(tx, current, event, `the registration was ${current.status.toLowerCase()}`);
                  outcome = 'orphaned';
                }
              }
            }
          } else if (isSettled) {
            // Paid, but not the amount or currency this registration expects.
            await flagOrphanedPayment(tx, registration, event, 'the amount or currency did not match the registration');
            outcome = 'orphaned';
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
      } else if (
        registration &&
        registration.checkoutSessionId === event.sessionId &&
        event.kind === 'checkout_completed' &&
        isSettledPayment(event)
      ) {
        // Money was taken for a registration that is no longer pending (for
        // example it expired or was withdrawn). Never resurrect it; flag it so
        // an admin can refund or reinstate by hand.
        await flagOrphanedPayment(tx, registration, event, `the registration was ${registration.status.toLowerCase()}`);
        outcome = 'orphaned';
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
        return { registrationId: event.registrationId, outcome: storedOutcome(existing.outcome) };
      }
    }
    throw error;
  }
}

export async function processPaymentEvent(
  deps: AppDeps,
  event: WebhookEvent,
  now: Date,
): Promise<PaymentConfirmationResult | null> {
  const result = await confirmPayment(deps.prisma, event, now);
  if (!result || result.outcome !== 'paid') return result;

  const registration = await deps.prisma.registration.findUnique({
    where: { id: result.registrationId },
    include: { event: true },
  });
  if (registration?.qrToken) {
    const ticketUrl = `${deps.env.WEB_ORIGIN}/ticket/${registration.qrToken}`;
    try {
      await sendConfirmation(deps, registration, registration.event, ticketUrl);
    } catch {
      // Delivery is made durable/retryable by the email log.
    }
  }
  return result;
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

      const result = await processPaymentEvent(deps, event, new Date());
      if (!result || result.outcome === 'ignored') {
        return reply.code(200).send({ status: 'ignored' });
      }
      if (result.outcome === 'already_paid') {
        return reply.code(200).send({ status: 'ok' });
      }
      if (result.outcome !== 'paid') {
        return reply.code(200).send({ status: result.outcome });
      }

      return reply.code(200).send({ status: 'ok' });
    });
  });
}

async function flagOrphanedPayment(
  tx: Prisma.TransactionClient,
  registration: { id: string; eventId: string },
  event: { paymentIntentId?: string | null; sessionId: string; amountCents: number; currency: string },
  why: string,
): Promise<void> {
  await tx.reviewItem.createMany({
    skipDuplicates: true,
    data: [{
      eventId: registration.eventId,
      registrationId: registration.id,
      reason: ORPHANED_PAYMENT_REVIEW_REASON,
      note: `Stripe payment ${event.paymentIntentId ?? '(no payment intent)'} for checkout ${event.sessionId} ` +
        `(${event.amountCents} ${event.currency.toUpperCase()}) was not applied because ${why}. Refund or reinstate manually.`,
    }],
  });
}
