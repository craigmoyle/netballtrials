import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { sendConfirmation } from '../registrations/confirmation';
import { sendEmailToRecipient } from '../messages/service';
import {
  RegistrationConflictError,
  RegistrationValidationError,
  createPendingRegistration,
} from '../registrations/service';
import type { RegistrationInput } from '../registrations/schemas';
import { consumeRateLimit } from '../security/rate-limit';
import { registerStripeWebhookRoute } from '../payments/webhook';
import { getPublicEvent, getTicket } from './service';

const REGISTRATION_LIMIT = 10;
const REGISTRATION_WINDOW_MS = 15 * 60_000;
const NEUTRAL_ACKNOWLEDGEMENT = { status: 'received' } as const;

function registrationRateKey(eventId: string, clientIp: string): string {
  return createHash('sha256')
    .update(`registration\0${eventId}\0${clientIp}`)
    .digest('hex');
}

async function sendCheckoutContinuation(
  deps: AppDeps,
  registration: {
    id: string;
    eventId: string;
    parentEmail: string;
    amountCents: number;
    currency: string;
    expiresAt: Date;
    checkoutSessionId: string | null;
  },
): Promise<void> {
  try {
    const checkout = await deps.payment.createCheckout({
      registrationId: registration.id,
      amountCents: registration.amountCents,
      currency: registration.currency,
      productName: 'Netball trials registration',
      successUrl: `${deps.env.WEB_ORIGIN}/register/${registration.eventId}/pending?session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${deps.env.WEB_ORIGIN}/register/${registration.eventId}`,
      expiresAt: registration.expiresAt,
    }, registration.id);
    if (!checkout.url || !checkout.sessionId) return;

    const saved = await deps.prisma.registration.updateMany({
      where: {
        id: registration.id,
        status: 'PENDING',
        checkoutSessionId: registration.checkoutSessionId,
      },
      data: { checkoutSessionId: checkout.sessionId },
    });
    if (saved.count === 0) {
      const current = await deps.prisma.registration.findUnique({
        where: { id: registration.id },
        select: { status: true, checkoutSessionId: true },
      });
      if (current?.status !== 'PENDING' || current.checkoutSessionId !== checkout.sessionId) return;
    }

    await sendEmailToRecipient(
      { prisma: deps.prisma, mailer: deps.mailer },
      {
        eventId: registration.eventId,
        registrationId: registration.id,
        to: registration.parentEmail,
        kind: 'checkout',
        batchId: `checkout:${registration.id}:${randomUUID()}`,
      },
      {
        subject: 'Continue your Netball Trials registration',
        text: `Use this secure link to continue checkout for the Netball Trials registration: ${checkout.url}\n\nIf you did not request this, contact the club.`,
      },
      new Date(),
    );
  } catch {
    // The request can be retried with the same registration/idempotency key.
    // Durable delivery diagnostics/retries are added by the Gmail delivery workstream.
  }
}

async function sendDuplicateGuidance(
  deps: AppDeps,
  registration: {
    id: string;
    eventId: string;
    status: string;
    playerFirstName: string;
    playerLastName: string;
    parentEmail: string;
    policyReference: string;
    qrToken: string | null;
  },
): Promise<void> {
  try {
    const event = await deps.prisma.event.findUnique({ where: { id: registration.eventId } });
    if (registration.status === 'PAID' && registration.qrToken && event) {
      await sendConfirmation(
        { prisma: deps.prisma, mailer: deps.mailer },
        registration,
        event,
        `${deps.env.WEB_ORIGIN}/ticket/${registration.qrToken}`,
        { batchId: `confirmation-resend:${registration.id}:${randomUUID()}` },
      );
      return;
    }
    await deps.mailer.send({
      to: registration.parentEmail,
      subject: 'Netball Trials registration help',
      text: 'A registration request needs your attention. Please check the original registration email or contact the club. We cannot send registration details to a different address.',
    });
  } catch {
    // Do not reveal delivery or registration state to the address supplied in a duplicate attempt.
  }
}

export function registerPublicRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerStripeWebhookRoute(app, deps);

  app.get('/api/public/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await getPublicEvent(deps.prisma, id);
    if (!event) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return event;
  });

  app.get('/api/public/checkout-sessions/:sessionId/status', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const registration = await deps.prisma.registration.findUnique({
      where: { checkoutSessionId: sessionId },
      select: { status: true },
    });
    if (!registration) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return { status: registration.status };
  });

  app.get('/api/public/ticket/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const ticket = await getTicket(deps.prisma, token);
    if (!ticket) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return ticket;
  });

  app.post('/api/public/events/:id/registrations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const now = new Date();
    const key = registrationRateKey(id, req.ip ?? 'unknown');
    if (!(await consumeRateLimit(deps.prisma, key, now, REGISTRATION_LIMIT, REGISTRATION_WINDOW_MS))) {
      return reply.code(429).send({ error: 'try_again_later' });
    }

    try {
      const registration = await createPendingRegistration(
        deps.prisma,
        id,
        req.body as RegistrationInput,
        now,
      );
      await sendCheckoutContinuation(deps, registration);
      return reply.code(202).send(NEUTRAL_ACKNOWLEDGEMENT);
    } catch (error) {
      if (error instanceof RegistrationValidationError) {
        return reply.code(400).send({ error: 'validation_failed', fields: error.fields });
      }
      if (error instanceof RegistrationConflictError) {
        if (error.reason === 'duplicate') {
          if (error.existing?.status === 'PENDING') {
            await sendCheckoutContinuation(deps, error.existing);
          } else if (error.existing?.status === 'PAID') {
            await sendDuplicateGuidance(deps, error.existing);
          }
          return reply.code(202).send(NEUTRAL_ACKNOWLEDGEMENT);
        }
        return reply.code(404).send({ error: 'not_found' });
      }
      throw error;
    }
  });
}
