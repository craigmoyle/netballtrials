import { beforeEach, describe, expect, it } from 'vitest';
import type { AppDeps } from '../../app';
import { prisma } from '../../db';
import { loadEnv } from '../../env';
import { createDevMailer } from '../../mail/dev-mailer';
import { createFakePaymentProvider } from '../../payments/fake';
import { createRegistrationCheckout, sendCheckoutContinuation } from '../../registrations/checkout';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

beforeEach(async () => {
  await resetDb();
  await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });
});

function makeDeps(provider: 'fake' | 'stripe' = 'fake') {
  const payment = createFakePaymentProvider();
  const mailer = createDevMailer([]);
  const deps = {
    prisma,
    payment,
    mailer,
    env: loadEnv(provider === 'fake'
      ? { NODE_ENV: 'test', PAYMENT_PROVIDER: 'fake' }
      : { NODE_ENV: 'test', PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
  } satisfies AppDeps;
  return { deps, payment, mailer };
}

async function createPendingRegistration() {
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  return prisma.registration.create({ data: registrationFixture(event.id) });
}

describe('createRegistrationCheckout', () => {
  it('persists a fake session without sending a checkout email', async () => {
    const registration = await createPendingRegistration();
    const { deps, payment, mailer } = makeDeps();

    const session = await createRegistrationCheckout(deps, registration);
    const saved = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });

    expect(session?.sessionId).toMatch(/^fake_/);
    expect(saved.checkoutSessionId).toBe(session?.sessionId);
    expect(payment.checkouts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(0);
  });

  it('keeps sending the Checkout link to the stored parent when requested', async () => {
    const registration = await createPendingRegistration();
    const { deps, mailer } = makeDeps();

    await expect(sendCheckoutContinuation(deps, registration)).resolves.toBe(true);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain('https://checkout.test/fake_');
  });

  it('expires a registration that never got a Checkout session so the parent can register again', async () => {
    const registration = await createPendingRegistration();
    const { deps } = makeDeps('stripe');
    const failing = { ...deps, payment: { ...deps.payment, createCheckout: async () => { throw new Error('Stripe unavailable'); } } };

    await expect(createRegistrationCheckout(failing, registration)).resolves.toBeNull();

    const saved = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(saved.status).toBe('EXPIRED');
  });

  it('leaves a registration with an existing Checkout session pending when a refresh fails', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
    const registration = await prisma.registration.create({ data: { ...registrationFixture(event.id), checkoutSessionId: 'cs_existing' } });
    const { deps } = makeDeps('stripe');
    const failing = { ...deps, payment: { ...deps.payment, createCheckout: async () => { throw new Error('Stripe unavailable'); } } };

    await expect(createRegistrationCheckout(failing, registration)).resolves.toBeNull();

    const saved = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(saved).toMatchObject({ status: 'PENDING', checkoutSessionId: 'cs_existing' });
  });
});
