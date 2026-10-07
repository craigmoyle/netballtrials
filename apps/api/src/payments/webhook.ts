import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AppDeps } from '../app';
import { generateToken } from '../auth/tokens';
import { sendConfirmation } from '../registrations/confirmation';
import type { WebhookEvent } from './provider';

export async function confirmPayment(
  prisma: PrismaClient,
  event: WebhookEvent,
  now: Date,
): Promise<{ registrationId: string; alreadyPaid: boolean } | null> {
  if (event.kind !== 'checkout_completed') {
    return null;
  }

  const registration = await prisma.registration.findUnique({
    where: { id: event.registrationId },
  });

  if (!registration || registration.amountCents !== event.amountCents) {
    return null;
  }

  if (registration.status === 'PAID') {
    return { registrationId: registration.id, alreadyPaid: true };
  }

  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      status: 'PAID',
      paidAt: now,
      paymentRef: event.paymentRef,
      qrToken: generateToken(),
    },
  });

  return { registrationId: registration.id, alreadyPaid: false };
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
      if (!result || result.alreadyPaid) {
        return reply.code(200).send({ status: result ? 'ok' : 'ignored' });
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
          // The payment is recorded; a failed confirmation must not make Stripe
          // retry and re-mark a paid registration. A later plan logs the failure.
        }
      }

      return reply.code(200).send({ status: 'ok' });
    });
  });
}
