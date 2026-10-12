import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { sendCheckoutContinuation } from '../registrations/checkout';
import { sendConfirmation } from '../registrations/confirmation';
import {
  RegistrationConflictError,
  RegistrationValidationError,
  createPendingRegistration,
} from '../registrations/service';
import type { RegistrationInput } from '../registrations/schemas';
import { consumeRateLimit } from '../security/rate-limit';
import { registerStripeWebhookRoute } from '../payments/webhook';
import { getPublicEvent, getTicket, getTicketCalendar, listPublicEvents } from './service';

const REGISTRATION_LIMIT = 10;
const REGISTRATION_WINDOW_MS = 15 * 60_000;
const NEUTRAL_ACKNOWLEDGEMENT = { status: 'received' } as const;

function registrationRateKey(eventId: string, clientIp: string): string {
  return createHash('sha256')
    .update(`registration\0${eventId}\0${clientIp}`)
    .digest('hex');
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

  app.get('/api/public/events', async () => listPublicEvents(deps.prisma));

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
      select: { status: true, qrToken: true },
    });
    if (!registration) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (registration.status !== 'PAID' || !registration.qrToken) return { status: registration.status };
    const token = encodeURIComponent(registration.qrToken);
    return {
      status: registration.status,
      ticketPath: `/ticket/${token}`,
      calendarUrl: `${deps.env.API_PUBLIC_URL.replace(/\/$/, '')}/api/public/ticket/${token}/calendar`,
      ticket: await getTicket(deps.prisma, registration.qrToken),
    };
  });

  app.get('/api/public/ticket/:token/calendar', async (req, reply) => {
    const { token } = req.params as { token: string };
    const file = await getTicketCalendar(deps.prisma, token);
    if (!file) return reply.code(404).send({ error: 'not_found' });
    return reply
      .type('text/calendar; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.calendar);
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
