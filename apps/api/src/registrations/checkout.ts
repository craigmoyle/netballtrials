import { randomUUID } from 'node:crypto';
import type { PrismaClient, Registration } from '@prisma/client';
import type { AppDeps } from '../app';
import { sendEmailToRecipient } from '../messages/service';
import type { CheckoutSession, PaymentProvider } from '../payments/provider';

export async function createRegistrationCheckout(
  deps: AppDeps,
  registration: Pick<Registration, 'id' | 'eventId' | 'parentEmail' | 'amountCents' | 'currency' | 'expiresAt' | 'checkoutSessionId'>,
): Promise<CheckoutSession | null> {
  try {
    if (deps.env.PAYMENT_PROVIDER === 'fake' && registration.checkoutSessionId?.startsWith('fake_sim_')) {
      const current = await deps.prisma.registration.findUnique({
        where: { id: registration.id },
        select: { status: true, checkoutSessionId: true },
      });
      if (current?.status !== 'PENDING' || current.checkoutSessionId !== registration.checkoutSessionId) return null;
      return {
        sessionId: registration.checkoutSessionId,
        url: `https://checkout.test/${registration.checkoutSessionId}`,
      };
    }

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
    deps.log?.error({ code: 'checkout_outcome_unknown' }, 'checkout_create_failed');
    // A lost response or failed local write can follow provider success. Keep
    // the pending registration so retries reuse its original idempotency key.
    return null;
  }
}

export async function assertNoUnverifiedPendingCheckouts(prisma: PrismaClient): Promise<void> {
  const count = await prisma.registration.count({
    where: {
      parentEmailVerifiedAt: null,
      checkoutSessionId: { not: null },
      OR: [{ status: 'PENDING' }, { status: 'WITHDRAWN', paidAt: null }],
    },
  });
  if (count > 0) {
    throw new Error('Unverified Checkout sessions remain; run npm run checkout:cutover -w @netball-trials/api before serving traffic');
  }
}

export async function expireUnverifiedPendingCheckouts(
  prisma: PrismaClient,
  payment: PaymentProvider,
): Promise<{ found: number; markedExpired: number; unresolved: string[] }> {
  const registrations = await prisma.registration.findMany({
    where: {
      parentEmailVerifiedAt: null,
      checkoutSessionId: { not: null },
      OR: [{ status: 'PENDING' }, { status: 'WITHDRAWN', paidAt: null }],
    },
    select: { id: true, status: true, checkoutSessionId: true },
    orderBy: { id: 'asc' },
  });
  let markedExpired = 0;
  const unresolved: string[] = [];
  for (const registration of registrations) {
    let providerExpired = false;
    try {
      providerExpired = await payment.expireCheckout(registration.checkoutSessionId!);
    } catch {
      unresolved.push(registration.id);
      continue;
    }
    if (!providerExpired) {
      unresolved.push(registration.id);
      continue;
    }
    const changed = await prisma.registration.updateMany({
      where: {
        id: registration.id,
        status: registration.status,
        parentEmailVerifiedAt: null,
        checkoutSessionId: registration.checkoutSessionId,
        ...(registration.status === 'WITHDRAWN' ? { paidAt: null } : {}),
      },
      data: { ...(registration.status === 'PENDING' ? { status: 'EXPIRED' as const } : {}), checkoutSessionId: null },
    });
    if (changed.count !== 1) {
      unresolved.push(registration.id);
      continue;
    }
    markedExpired += 1;
  }
  return { found: registrations.length, markedExpired, unresolved };
}

export async function sendCheckoutContinuation(
  deps: AppDeps,
  registration: Pick<Registration, 'id' | 'eventId' | 'parentEmail' | 'amountCents' | 'currency' | 'expiresAt' | 'checkoutSessionId'>,
  now = new Date(),
  options: { batchId?: string; senderUserId?: string } = {},
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
        batchId: options.batchId ?? `checkout:${registration.id}:${randomUUID()}`,
        senderUserId: options.senderUserId,
      },
      {
        subject: 'Continue your Netball Trials registration',
        text: `Use this secure link to continue checkout for the Netball Trials registration: ${checkout.url}\n\nIf you did not request this, contact the club.`,
      },
      now,
    );
    return delivery.sent === 1;
  } catch {
    // Durable delivery diagnostics/retries are recorded by the email log.
    return false;
  }
}
