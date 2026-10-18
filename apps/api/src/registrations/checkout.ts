import { randomUUID } from 'node:crypto';
import type { Registration } from '@prisma/client';
import type { AppDeps } from '../app';
import { sendEmailToRecipient } from '../messages/service';
import type { CheckoutSession } from '../payments/provider';

export async function createRegistrationCheckout(
  deps: AppDeps,
  registration: Pick<Registration, 'id' | 'eventId' | 'parentEmail' | 'amountCents' | 'currency' | 'expiresAt' | 'checkoutSessionId'>,
): Promise<CheckoutSession | null> {
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
    if (!checkout.url || !checkout.sessionId) return null;

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
      if (current?.status !== 'PENDING' || current.checkoutSessionId !== checkout.sessionId) return null;
    }

    return checkout;
  } catch {
    return null;
  }
}

export async function sendCheckoutContinuation(
  deps: AppDeps,
  registration: Pick<Registration, 'id' | 'eventId' | 'parentEmail' | 'amountCents' | 'currency' | 'expiresAt' | 'checkoutSessionId'>,
): Promise<boolean> {
  const checkout = await createRegistrationCheckout(deps, registration);
  if (!checkout) return false;

  try {
    const delivery = await sendEmailToRecipient(
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
    return delivery.sent === 1;
  } catch {
    // Durable delivery diagnostics/retries are recorded by the email log.
    return false;
  }
}
