import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import {
  RegistrationConflictError,
  RegistrationValidationError,
  createPendingRegistration,
} from '../registrations/service';
import type { RegistrationInput } from '../registrations/schemas';
import { registerStripeWebhookRoute } from '../payments/webhook';
import { getPublicEvent } from './service';

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

  app.post('/api/public/events/:id/registrations', async (req, reply) => {
    const { id } = req.params as { id: string };

    try {
      const registration = await createPendingRegistration(
        deps.prisma,
        id,
        req.body as RegistrationInput,
        new Date(),
      );

      const event = await getPublicEvent(deps.prisma, id);
      const checkout = await deps.payment.createCheckout({
        registrationId: registration.id,
        amountCents: registration.amountCents,
        currency: registration.currency,
        productName: `${event?.name ?? 'Trial'} registration`,
        successUrl: `${deps.env.WEB_ORIGIN}/register/${id}/pending?registration=${registration.id}`,
        cancelUrl: `${deps.env.WEB_ORIGIN}/register/${id}`,
        expiresAt: registration.expiresAt,
      });

      await deps.prisma.registration.update({
        where: { id: registration.id },
        data: { paymentRef: checkout.sessionId },
      });

      return reply
        .code(201)
        .send({ registrationId: registration.id, checkoutUrl: checkout.url });
    } catch (err) {
      if (err instanceof RegistrationValidationError) {
        return reply
          .code(400)
          .send({ error: 'validation_failed', fields: err.fields });
      }
      if (err instanceof RegistrationConflictError) {
        if (err.reason === 'duplicate') {
          return reply.code(409).send({ error: 'duplicate' });
        }
        return reply.code(404).send({ error: 'not_found' });
      }
      throw err;
    }
  });
}
