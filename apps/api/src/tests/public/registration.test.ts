import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createFakePaymentProvider } from '../../payments/fake';
import { createDevMailer } from '../../mail/dev-mailer';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

let app: ReturnType<typeof createApp>;
let eventId: string;
let payment: ReturnType<typeof createFakePaymentProvider>;
let mailer: ReturnType<typeof createDevMailer>;

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  eventId = event.id;
  await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });
  payment = createFakePaymentProvider();
  mailer = createDevMailer([]);
  app = createApp({ payment, mailer, env: testEnv() });
});

const payload = {
  playerFirstName: 'Ada', playerLastName: 'Lovelace', dateOfBirth: '2011-04-02',
  parentName: 'Anne', parentEmail: 'anne@example.com', parentMobile: '0400000000',
  memberAssociation: 'MENA', rank1Position: 'GS', optInExtraPositions: false, parentAuthorityConfirmed: true, eligibilityConfirmed: true,
};

async function verifyLatestParentEmail(): Promise<string> {
  const email = [...mailer.sent].reverse().find((message) => message.subject === 'Confirm your Netball Trials email');
  expect(email).toBeDefined();
  const link = email!.text.match(/https?:\/\/[^\s]+/)?.[0];
  expect(link).toBeTruthy();
  const token = new URLSearchParams(new URL(link!).hash.slice(1)).get('token');
  expect(token).toBeTruthy();
  const response = await app.inject({ method: 'POST', url: '/api/public/parent-access/verify', payload: { token } });
  expect(response.statusCode).toBe(200);
  return response.cookies.find((cookie) => cookie.name === 'nt_parent')!.value;
}

async function continueParentCheckout(registrationId: string, parentSession: string) {
  return app.inject({
    method: 'POST', url: `/api/parent/registrations/${registrationId}/checkout`,
    cookies: { nt_parent: parentSession },
  });
}

async function registerAndContinue(input = payload) {
  const response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload: input });
  const registration = await prisma.registration.findFirstOrThrow({ where: { eventId, playerNameNormalized: `${input.playerFirstName} ${input.playerLastName}`.toLowerCase() } });
  const parentSession = await verifyLatestParentEmail();
  const checkout = await continueParentCheckout(registration.id, parentSession);
  return { response, registration, parentSession, checkout };
}

describe('POST /api/public/events/:id/registrations', () => {
  it('requires email confirmation before a parent can continue to Checkout', async () => {
    const response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'received' });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    expect(registration).toMatchObject({ status: 'PENDING', parentAuthorityConfirmedAt: expect.any(Date), parentEmailVerifiedAt: null, checkoutSessionId: null });
    expect(payment.checkouts).toHaveLength(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].subject).toBe('Confirm your Netball Trials email');
    expect(mailer.sent[0].text).toContain('registration is not complete until this email is verified and payment is confirmed');
    expect(mailer.sent[0].text).not.toContain('Ada Lovelace');

    const parentSession = await verifyLatestParentEmail();
    const verified = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(verified.parentEmailVerifiedAt).toBeInstanceOf(Date);
    const checkout = await continueParentCheckout(registration.id, parentSession);
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().simulationToken).toBe((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkoutSessionId);
    expect(payment.checkouts).toHaveLength(1);
    expect(payment.checkouts[0].successUrl).toContain('session={CHECKOUT_SESSION_ID}');
    expect(payment.checkouts[0].successUrl).not.toContain(registration.id);
  });

  it('creates Checkout only after the parent verifies their email when Stripe is selected', async () => {
    app = createApp({ payment, mailer, env: { ...testEnv(), PAYMENT_PROVIDER: 'stripe' } });
    const response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'received' });
    expect(payment.checkouts).toHaveLength(0);
    expect(mailer.sent).toHaveLength(1);

    const parentSession = await verifyLatestParentEmail();
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const checkout = await continueParentCheckout(registration.id, parentSession);
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().checkoutUrl).toMatch(/^https:\/\/checkout\.test\//);
    expect(payment.checkouts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it('allows Checkout retry after email confirmation if Checkout setup initially fails', async () => {
    const createCheckout = vi.fn()
      .mockRejectedValueOnce(new Error('Stripe unavailable'))
      .mockImplementation((request, key) => payment.createCheckout(request, key));
    app = createApp({ payment: { ...payment, createCheckout }, mailer, env: { ...testEnv(), PAYMENT_PROVIDER: 'stripe' } });

    const submitted = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toEqual({ status: 'received' });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    expect(registration).toMatchObject({ status: 'PENDING', parentEmailVerifiedAt: null, checkoutSessionId: null });
    const parentSession = await verifyLatestParentEmail();
    const failedCheckout = await continueParentCheckout(registration.id, parentSession);
    expect(failedCheckout.statusCode).toBe(503);
    expect(failedCheckout.json()).toEqual({ error: 'checkout_unavailable' });

    const retried = await continueParentCheckout(registration.id, parentSession);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().checkoutUrl).toContain('checkout.test');
    expect(createCheckout).toHaveBeenCalledTimes(2);
    expect(createCheckout.mock.calls[0]?.[1]).toBe(createCheckout.mock.calls[1]?.[1]);
  });

  it('does not permit public registration after registration is closed', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: 'CLOSED' } });
    const response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
    expect(payment.checkouts).toHaveLength(0);
    expect(mailer.sent.filter((message) => message.subject === 'Continue your Netball Trials registration')).toHaveLength(0);
  });

  it('returns the same neutral response for a duplicate and only emails the stored address', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });
    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(first.statusCode);
    expect(duplicate.json()).toEqual(first.json());
    expect(duplicate.json()).toEqual({ status: 'received' });
    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
    expect(mailer.sent.some((message) => message.to === 'intruder@example.com')).toBe(false);
    expect(mailer.sent.every((message) => message.to === 'anne@example.com' && message.subject === 'Confirm your Netball Trials email')).toBe(true);
  });

  it('resends a paid confirmation only to the previously stored parent address', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, { status: 'PAID', checkoutSessionId: 'fake_existing_paid', qrToken: 'r'.repeat(43) }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'received' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain('/ticket/');
    expect(mailer.sent[0].text).not.toContain('intruder@example.com');
  });

  it('reuses one pending registration across retries and requires verification before Checkout', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const retry = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(first.json()).toEqual({ status: 'received' });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toEqual({ status: 'received' });
    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
    expect(registration.parentEmailVerifiedAt).toBeNull();
    expect(payment.checkouts).toHaveLength(0);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent.every((message) => message.to === 'anne@example.com' && message.subject === 'Confirm your Netball Trials email')).toBe(true);

    const parentSession = await verifyLatestParentEmail();
    const checkout = await continueParentCheckout(registration.id, parentSession);
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().simulationToken).toBe((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkoutSessionId);
    expect(payment.checkouts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(2);
  });

  it('keeps fake Checkout retryable after a provider failure following email verification', async () => {
    const fake = createFakePaymentProvider();
    const createCheckout = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockImplementation((request, idempotencyKey) => fake.createCheckout(request, idempotencyKey));
    app = createApp({ mailer, payment: { ...fake, createCheckout }, env: testEnv() });

    const submitted = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(submitted.statusCode).toBe(202);
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const parentSession = await verifyLatestParentEmail();
    const failedCheckout = await continueParentCheckout(registration.id, parentSession);
    expect(failedCheckout.statusCode).toBe(503);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({ status: 'PENDING', checkoutSessionId: null });

    const retry = await continueParentCheckout(registration.id, parentSession);
    const simulationToken = retry.json().simulationToken as string;
    const completion = await app.inject({ method: 'POST', url: '/api/public/fake-checkouts/complete', payload: { simulationToken } });
    expect(retry.statusCode).toBe(200);
    expect(simulationToken).toMatch(/^fake_[\w-]+$/);
    expect(createCheckout).toHaveBeenCalledTimes(2);
    expect(createCheckout.mock.calls[0]?.[1]).toBe(createCheckout.mock.calls[1]?.[1]);
    expect(completion.json()).toEqual({ status: 'paid' });
    expect((await prisma.registration.findFirstOrThrow({ where: { id: registration.id } })).status).toBe('PAID');
  });

  it('persists the same fake Checkout session after a transient session-write failure', async () => {
    const updateMany = prisma.registration.updateMany.bind(prisma.registration);
    vi.spyOn(prisma.registration, 'updateMany')
      .mockRejectedValueOnce(new Error('transient session write failure'))
      .mockImplementation((args) => updateMany(args));
    await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const parentSession = await verifyLatestParentEmail();
    const failed = await continueParentCheckout(registration.id, parentSession);
    expect(failed.statusCode).toBe(503);

    const response = await continueParentCheckout(registration.id, parentSession);
    const simulationToken = response.json().simulationToken as string;
    const completion = await app.inject({ method: 'POST', url: '/api/public/fake-checkouts/complete', payload: { simulationToken } });

    expect(response.statusCode).toBe(200);
    expect(simulationToken).toBe((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkoutSessionId);
    expect(completion.json()).toEqual({ status: 'paid' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).status).toBe('PAID');
  });

  it('limits repeated registration and recovery attempts by client address', async () => {
    let response;
    for (let index = 0; index < 10; index += 1) {
      response = await app.inject({
        method: 'POST',
        url: `/api/public/events/${eventId}/registrations`,
        payload: { ...payload, playerFirstName: `Player${index}` },
      });
      expect(response.statusCode).toBe(202);
    }
    response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: 'try_again_later' });
  });

  it('uses the opaque Checkout session for public status and not the registration ID', async () => {
    const { registration, checkout } = await registerAndContinue();
    const sessionId = checkout.json().simulationToken as string;
    const status = await app.inject({ method: 'GET', url: `/api/public/checkout-sessions/${sessionId}/status` });
    const byId = await app.inject({ method: 'GET', url: `/api/public/checkout-sessions/${registration.id}/status` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ status: 'PENDING' });
    expect(byId.statusCode).toBe(404);
  });

  it('returns a ticket and calendar continuation only after confirmed payment', async () => {
    const token = 'paid-ticket-token-12345678901234567890';
    await prisma.registration.create({
      data: registrationFixture(eventId, { status: 'PAID', checkoutSessionId: 'cs_paid', qrToken: token }),
    });
    const status = await app.inject({ method: 'GET', url: '/api/public/checkout-sessions/cs_paid/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      status: 'PAID',
      ticketPath: `/ticket/${token}`,
      calendarUrl: `http://localhost:3000/api/public/ticket/${token}/calendar`,
      ticket: { playerName: 'Ada Lovelace', event: { name: '15/U Ladies' } },
    });
    expect(status.json().ticket.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(status.json().ticket).not.toHaveProperty('parentEmail');
  });

  it('returns per-field errors for invalid input', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload: { ...payload, rank1Position: 'XX' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });
});

describe('POST /api/public/fake-checkouts/complete', () => {
  const url = '/api/public/fake-checkouts/complete';
  const complete = (simulationToken: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url, payload: { simulationToken, ...extra } });

  it('confirms a pending session, sends its ticket once, and returns status', async () => {
    const { checkout } = await registerAndContinue();
    const simulationToken = checkout.json().simulationToken as string;

    const completed = await complete(simulationToken);
    const replay = await complete(simulationToken);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ status: 'paid' });
    expect(replay.json()).toEqual({ status: 'paid' });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    expect(registration).toMatchObject({ status: 'PAID', checkoutSessionId: simulationToken });
    expect(registration.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const status = await app.inject({ method: 'GET', url: `/api/public/checkout-sessions/${simulationToken}/status` });
    const confirmation = await prisma.emailLog.findFirstOrThrow({ where: { registrationId: registration.id, kind: 'confirmation' } });
    expect(confirmation.status).toBe('SENT');
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0].subject).toBe('Confirm your Netball Trials email');
    expect(mailer.sent[1].to).toBe('anne@example.com');
    expect(mailer.sent[1].subject).toContain('Trial registration confirmed');
    expect(status.json()).toMatchObject({
      status: 'PAID',
      ticket: { playerName: 'Ada Lovelace', event: { name: '15/U Ladies' } },
    });
  });

  it('uses stored payment details instead of client-supplied values', async () => {
    const { checkout } = await registerAndContinue();
    const simulationToken = checkout.json().simulationToken as string;

    const response = await complete(simulationToken, { amountCents: 1, currency: 'usd', registrationId: 'another-registration' });

    expect(response.json()).toEqual({ status: 'paid' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).status).toBe('PAID');
  });

  it('cannot use a duplicate submission to create a second Checkout session', async () => {
    const { registration, checkout } = await registerAndContinue();
    const duplicate = await app.inject({
      method: 'POST', url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });
    const response = await complete('fake_intruder_session');

    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toEqual({ status: 'received' });
    expect(response.json()).toEqual({ status: 'not_completed' });
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).status).toBe('PENDING');
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } })).checkoutSessionId).toBe(checkout.json().simulationToken);
    expect(mailer.sent.every((message) => message.to !== 'intruder@example.com')).toBe(true);
  });

  it.each([
    ['missing', {}] as const,
    ['empty', { simulationToken: '' }] as const,
    ['non-string', { simulationToken: 42 }] as const,
  ])('returns a generic result for a %s token', async (_label, body) => {
    const response = await app.inject({ method: 'POST', url, payload: body });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'not_completed' });
  });

  it('returns a generic result for an unknown token', async () => {
    const response = await complete('fake_unknown_session');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'not_completed' });
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
  });

  it('does not complete an expired session', async () => {
    const { checkout } = await registerAndContinue();
    const simulationToken = checkout.json().simulationToken as string;
    await prisma.registration.updateMany({ where: { eventId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await complete(simulationToken);

    expect(response.json()).toEqual({ status: 'not_completed' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).status).toBe('PENDING');
  });

  it('does not complete a withdrawn session', async () => {
    const { checkout } = await registerAndContinue();
    const simulationToken = checkout.json().simulationToken as string;
    await prisma.registration.updateMany({ where: { eventId }, data: { status: 'WITHDRAWN' } });

    const response = await complete(simulationToken);

    expect(response.json()).toEqual({ status: 'not_completed' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).qrToken).toBeNull();
  });

  it('handles simultaneous completion requests without duplicate confirmations', async () => {
    const { checkout } = await registerAndContinue();
    const simulationToken = checkout.json().simulationToken as string;

    const responses = await Promise.all([complete(simulationToken), complete(simulationToken)]);
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });

    expect(responses.map((response) => response.json())).toEqual([{ status: 'paid' }, { status: 'paid' }]);
    expect(registration.status).toBe('PAID');
    expect(await prisma.emailLog.count({ where: { registrationId: registration.id, kind: 'confirmation' } })).toBe(1);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0].subject).toBe('Confirm your Netball Trials email');
    expect(mailer.sent[1].subject).toContain('Trial registration confirmed');
  });
});

function testEnv() {
  return {
    DATABASE_URL: '', NODE_ENV: 'test' as const, PAYMENT_PROVIDER: 'fake' as const,
    WEB_ORIGIN: 'http://localhost:5173', API_PUBLIC_URL: 'http://localhost:3000', TRUST_PROXY: '',
    SESSION_COOKIE_SECURE: false, MAIL_FROM: 'chisholmnetball@gmail.com', MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
    GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '',
    STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'y', PORT: 3000,
  };
}
