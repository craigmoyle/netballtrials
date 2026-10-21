import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('uses an injected registration clock when checking checkout mail expiry', async () => {
    const now = new Date('2026-09-11T14:30:00Z');
    const registration = await createPendingRegistration();
    await prisma.registration.update({ where: { id: registration.id }, data: { expiresAt: new Date(+now + 86_400_000) } });
    const { deps, mailer } = makeDeps();
    expect(await sendCheckoutContinuation(deps, registration, now)).toBe(true);
    expect(mailer.sent).toHaveLength(1);
  });

  it('keeps an unbound registration pending when the provider outcome is unknown', async () => {
    const registration = await createPendingRegistration();
    const { deps } = makeDeps('stripe');
    const failing = { ...deps, payment: { ...deps.payment, createCheckout: async () => { throw new Error('Stripe unavailable'); } } };

    await expect(createRegistrationCheckout(failing, registration)).resolves.toBeNull();

    const saved = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(saved.status).toBe('PENDING');
  });

  it.each(['response lost', 'database write failed'])('recovers the same external session after %s without abandoning the registration', async (failure) => {
    const registration = await createPendingRegistration();
    const { deps } = makeDeps('stripe');
    const sessions = new Map<string, { sessionId: string; url: string }>();
    let first = true;
    const createCheckout = vi.fn(async (_request, key: string) => {
      if (!sessions.has(key)) sessions.set(key, { sessionId: `cs_${key}`, url: `https://checkout.test/${key}` });
      if (failure === 'response lost' && first) {
        first = false;
        throw new Error('response lost with secret-token');
      }
      return sessions.get(key)!;
    });
    const extended = prisma.$extends({ query: { registration: { async updateMany({ args, query }) {
      if (failure === 'database write failed' && first && args.data.checkoutSessionId) {
        first = false;
        throw new Error('DB query containing secret-token');
      }
      return query(args);
    } } } });
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const recovering = { ...deps, prisma: extended as typeof prisma, payment: { ...deps.payment, createCheckout }, log };
    expect(await createRegistrationCheckout(recovering, registration)).toBeNull();
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: 'PENDING', checkoutSessionId: null });
    expect(await createRegistrationCheckout(recovering, registration)).toEqual(sessions.get(registration.id));
    expect(sessions.size).toBe(1);
    expect(createCheckout.mock.calls.map((call) => call[1])).toEqual([registration.id, registration.id]);
    expect(await prisma.registration.count()).toBe(1);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: 'PENDING', checkoutSessionId: `cs_${registration.id}` });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret-token');
  });

  it('does not let a failing concurrent caller invalidate a successful checkout', async () => {
    const registration = await createPendingRegistration();
    const { deps } = makeDeps('stripe');
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const finish = new Promise<void>((resolve) => { release = resolve; });
    const session = { sessionId: 'cs_shared', url: 'https://checkout.test/shared' };
    let calls = 0;
    const concurrent = { ...deps, payment: { ...deps.payment, createCheckout: async () => {
      if (++calls === 1) { entered(); await finish; return session; }
      throw new Error('idempotency key in use');
    } } };
    const successful = createRegistrationCheckout(concurrent, registration);
    await started;
    try { expect(await createRegistrationCheckout(concurrent, registration)).toBeNull(); }
    finally { release(); }
    expect(await successful).toEqual(session);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: 'PENDING', checkoutSessionId: 'cs_shared' });
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
