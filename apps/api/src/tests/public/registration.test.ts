import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createFakePaymentProvider } from '../../payments/fake';
import { createDevMailer } from '../../mail/dev-mailer';
import { resetDb } from '../helpers/db';
import { registrationFixture } from '../helpers/fixtures';

let app: ReturnType<typeof createApp>;
let eventId: string;
let payment: ReturnType<typeof createFakePaymentProvider>;
let mailer: ReturnType<typeof createDevMailer>;

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

const received = { status: 'received' };

describe('POST /api/public/events/:id/registrations', () => {
  it('returns a neutral acknowledgement and mails the checkout continuation', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual(received);
    expect(await prisma.registration.count({ where: { eventId, status: 'PENDING' } })).toBe(1);
    expect(payment.checkouts).toHaveLength(1);
    expect(payment.checkouts[0].successUrl).toContain('session={CHECKOUT_SESSION_ID}');
    expect(payment.checkouts[0].successUrl).not.toContain(payment.checkouts[0].registrationId);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain('checkout.test');
  });

  it('returns the same response for a duplicate and sends recovery only to the stored address', async () => {
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });
    expect(first.statusCode).toBe(202);
    expect(duplicate.statusCode).toBe(first.statusCode);
    expect(duplicate.json()).toEqual(first.json());
    expect(mailer.sent.some((message) => message.to === 'intruder@example.com')).toBe(false);
    expect(mailer.sent.some((message) => message.to === 'anne@example.com')).toBe(true);
  });

  it('resends a paid confirmation only to the previously stored parent address', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, { status: 'PAID', qrToken: 'r'.repeat(43) }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/public/events/${eventId}/registrations`,
      payload: { ...payload, parentEmail: 'intruder@example.com' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(received);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('anne@example.com');
    expect(mailer.sent[0].text).toContain('/ticket/');
    expect(mailer.sent[0].text).not.toContain('intruder@example.com');
  });

  it('reuses the pending Checkout session when the original parent retries', async () => {
    await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const originalUrl = mailer.sent[0].text.match(/https:\/\/checkout\.test\/\S+/)?.[0];
    const retry = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const retryUrl = mailer.sent[1].text.match(/https:\/\/checkout\.test\/\S+/)?.[0];
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toEqual(received);
    expect(payment.checkouts).toHaveLength(1);
    expect(retryUrl).toBe(originalUrl);
  });

  it('recovers from a transient Checkout-provider failure on the same request', async () => {
    const fake = createFakePaymentProvider();
    const createCheckout = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockImplementation((request, idempotencyKey) => fake.createCheckout(request, idempotencyKey));
    app = createApp({
      mailer,
      payment: { ...fake, createCheckout },
      env: testEnv(),
    });
    const first = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const retry = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);
    expect(first.json()).toEqual(retry.json());
    expect(createCheckout).toHaveBeenCalledTimes(2);
    expect(mailer.sent.map((message) => message.to)).toEqual(['anne@example.com']);
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

function testEnv() {
  return {
    DATABASE_URL: '', NODE_ENV: 'test' as const, PAYMENT_PROVIDER: 'fake' as const,
    WEB_ORIGIN: 'http://localhost:5173', API_PUBLIC_URL: 'http://localhost:3000', TRUST_PROXY: '',
    SESSION_COOKIE_SECURE: false, MAIL_FROM: 'chisholmnetball@gmail.com', MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
    GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '',
    STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'y', PORT: 3000,
  };
}

function eventFixture() {
  return {
    name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
    eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
    firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
    rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
  };
}
