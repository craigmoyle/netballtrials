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
  memberAssociation: 'MENA', rank1Position: 'GS', optInExtraPositions: false, eligibilityConfirmed: true,
};

describe('POST /api/public/events/:id/registrations', () => {
  it('returns a neutral acknowledgement and simulation token without mailing public checkout', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const acknowledgement = res.json();
    expect(res.statusCode).toBe(202);
    expect(acknowledgement).toMatchObject({ status: 'received', simulationToken: expect.any(String) });
    expect(Object.keys(acknowledgement).sort()).toEqual(['simulationToken', 'status']);
    expect(await prisma.registration.count({ where: { eventId, status: 'PENDING' } })).toBe(1);
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    expect(acknowledgement.simulationToken).toBe(registration.checkoutSessionId);
    expect(acknowledgement).not.toHaveProperty('registrationId');
    expect(acknowledgement).not.toHaveProperty('parentEmail');
    expect(payment.checkouts).toHaveLength(1);
    expect(payment.checkouts[0].successUrl).toContain('session={CHECKOUT_SESSION_ID}');
    expect(payment.checkouts[0].successUrl).not.toContain(payment.checkouts[0].registrationId);
    expect(mailer.sent).toHaveLength(0);
  });

  it('retains email checkout when Stripe is selected', async () => {
    app = createApp({
      payment,
      mailer,
      env: { ...testEnv(), PAYMENT_PROVIDER: 'stripe' },
    });
    const response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'received' });
    expect(payment.checkouts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain('checkout.test');
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

  it('returns the same neutral shape for a duplicate and keeps recovery at the stored address', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });
    const firstAcknowledgement = first.json();
    const duplicateAcknowledgement = duplicate.json();
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(first.statusCode);
    expect(duplicateAcknowledgement.status).toBe(firstAcknowledgement.status);
    expect(Object.keys(duplicateAcknowledgement).sort()).toEqual(Object.keys(firstAcknowledgement).sort());
    expect(duplicateAcknowledgement.simulationToken).not.toBe(firstAcknowledgement.simulationToken);
    expect(duplicateAcknowledgement.simulationToken).not.toBe(registration.checkoutSessionId);
    expect(mailer.sent.some((message) => message.to === 'intruder@example.com')).toBe(false);
    expect(mailer.sent.some((message) => message.to === 'anne@example.com')).toBe(true);
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
    expect(response.json()).toMatchObject({ status: 'received', simulationToken: expect.any(String) });
    expect(response.json().simulationToken).not.toBe('fake_existing_paid');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain('/ticket/');
    expect(mailer.sent[0].text).not.toContain('intruder@example.com');
  });

  it('reuses the pending Checkout session when the original parent retries', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const retry = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ status: 'received', simulationToken: expect.any(String) });
    expect(retry.json().simulationToken).not.toBe(registration.checkoutSessionId);
    expect(first.json().simulationToken).toBe(registration.checkoutSessionId);
    expect(payment.checkouts).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain(`https://checkout.test/${registration.checkoutSessionId}`);
  });

  it('keeps a fake simulation usable after Checkout setup fails and a duplicate retry', async () => {
    const fake = createFakePaymentProvider();
    const createCheckout = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockImplementation((request, idempotencyKey) => fake.createCheckout(request, idempotencyKey));
    app = createApp({ mailer, payment: { ...fake, createCheckout }, env: testEnv() });

    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const firstToken = first.json().simulationToken as string;
    const afterFirst = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const retry = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const afterRetry = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const completion = await app.inject({
      method: 'POST', url: '/api/public/fake-checkouts/complete', payload: { simulationToken: firstToken },
    });

    expect(first.statusCode).toBe(202);
    expect(firstToken).toMatch(/^fake_sim_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(afterFirst.checkoutSessionId).toBe(firstToken);
    expect(retry.statusCode).toBe(202);
    expect(retry.json().status).toBe('received');
    expect(retry.json().simulationToken).not.toBe(firstToken);
    expect(afterRetry.checkoutSessionId).toBe(firstToken);
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain(`https://checkout.test/${firstToken}`);
    expect(completion.json()).toEqual({ status: 'paid' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).status).toBe('PAID');
  });

  it('persists a bound simulation token after a transient Checkout-session write failure', async () => {
    const updateMany = prisma.registration.updateMany.bind(prisma.registration);
    vi.spyOn(prisma.registration, 'updateMany')
      .mockRejectedValueOnce(new Error('transient session write failure'))
      .mockImplementation((args) => updateMany(args));

    const response = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const simulationToken = response.json().simulationToken as string;
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const completion = await app.inject({
      method: 'POST', url: '/api/public/fake-checkouts/complete', payload: { simulationToken },
    });

    expect(response.statusCode).toBe(202);
    expect(registration.checkoutSessionId).toBe(simulationToken);
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
    await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const status = await app.inject({ method: 'GET', url: `/api/public/checkout-sessions/${registration.checkoutSessionId}/status` });
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
    const registered = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const simulationToken = registered.json().simulationToken as string;

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
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(status.json()).toMatchObject({
      status: 'PAID',
      ticket: { playerName: 'Ada Lovelace', event: { name: '15/U Ladies' } },
    });
  });

  it('uses stored payment details instead of client-supplied values', async () => {
    const registered = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const simulationToken = registered.json().simulationToken as string;

    const response = await complete(simulationToken, { amountCents: 1, currency: 'usd', registrationId: 'another-registration' });

    expect(response.json()).toEqual({ status: 'paid' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).status).toBe('PAID');
  });

  it('cannot use a duplicate request token to complete the stored registration', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const duplicate = await app.inject({
      method: 'POST', url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });

    const response = await complete(duplicate.json().simulationToken);
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });

    expect(response.json()).toEqual({ status: 'not_completed' });
    expect(registration.status).toBe('PENDING');
    expect(registration.checkoutSessionId).toBe(first.json().simulationToken);
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
    const registered = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const simulationToken = registered.json().simulationToken as string;
    await prisma.registration.updateMany({ where: { eventId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await complete(simulationToken);

    expect(response.json()).toEqual({ status: 'not_completed' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).status).toBe('PENDING');
  });

  it('does not complete a withdrawn session', async () => {
    const registered = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const simulationToken = registered.json().simulationToken as string;
    await prisma.registration.updateMany({ where: { eventId }, data: { status: 'WITHDRAWN' } });

    const response = await complete(simulationToken);

    expect(response.json()).toEqual({ status: 'not_completed' });
    expect((await prisma.registration.findFirstOrThrow({ where: { eventId } })).qrToken).toBeNull();
  });

  it('handles simultaneous completion requests without duplicate confirmations', async () => {
    const registered = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const simulationToken = registered.json().simulationToken as string;

    const responses = await Promise.all([complete(simulationToken), complete(simulationToken)]);
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });

    expect(responses.map((response) => response.json())).toEqual([{ status: 'paid' }, { status: 'paid' }]);
    expect(registration.status).toBe('PAID');
    expect(await prisma.emailLog.count({ where: { registrationId: registration.id, kind: 'confirmation' } })).toBe(1);
    expect(mailer.sent).toHaveLength(1);
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
