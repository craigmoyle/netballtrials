import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createDevMailer } from '../../mail/dev-mailer';
import { createFakePaymentProvider } from '../../payments/fake';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const eventDate = new Date('2026-09-12T00:00:00.000Z');
const now = new Date('2026-09-11T14:30:00.000Z');
const nowHeader = { 'x-test-now': now.toISOString() };
const input = {
  playerFirstName: 'Ada', playerLastName: 'Lovelace', dateOfBirth: '2012-04-02',
  parentName: 'Anne', parentEmail: 'anne@example.com', parentMobile: '0400000000',
  memberAssociation: 'MENA', rank1Position: 'GS', optInExtraPositions: false, parentAuthorityConfirmed: true, eligibilityConfirmed: true,
};
const received = { status: 'received' };
const fakeSessionIdPattern = /^fake_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let app: ReturnType<typeof createApp>;
let eventId: string;
let adminCookie: string;
let payment: ReturnType<typeof createFakePaymentProvider>;
let mailer: ReturnType<typeof createDevMailer>;

async function submit(payload: Record<string, unknown> = input) {
  return app.inject({
    method: 'POST', url: `/api/admin/events/${eventId}/day-of-registration`,
    cookies: { nt_session: adminCookie }, headers: nowHeader, payload,
  });
}

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({
    data: eventFixture({ name: '15/U Ladies', eventDate, status: 'CLOSED', checkInClosedAt: null }),
  });
  eventId = event.id;
  await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });
  payment = createFakePaymentProvider();
  mailer = createDevMailer([]);
  app = createApp({ payment, mailer, env: testEnv() });
  adminCookie = await signInAsNewAdmin(app, 'day-of-admin@example.com');
  mailer.sent.splice(0);
});

describe('POST /api/admin/events/:id/day-of-registration', () => {
  it('accepts a CLOSED event on its Melbourne date and leaves checkout pending', async () => {
    const response = await submit();

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(received);
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    expect(registration).toMatchObject({ status: 'PENDING', parentEmail: 'anne@example.com' });
    expect(registration.checkoutSessionId).toMatch(fakeSessionIdPattern);
    expect(payment.checkouts).toHaveLength(1);
    const checkoutEmail = mailer.sent.find((message) => message.subject === 'Continue your Netball Trials registration');
    expect(checkoutEmail?.to).toBe('anne@example.com');
    expect(checkoutEmail?.text).toContain(`https://checkout.test/${registration.checkoutSessionId}`);

    const opened = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/check-in/session`,
      cookies: { nt_session: adminCookie }, headers: nowHeader,
    });
    const checkInCookie = opened.cookies.find((cookie) => cookie.name === 'nt_checkin')!;
    const lookup = await app.inject({ method: 'GET', url: '/api/check-in/lookup?q=Ada', cookies: { nt_checkin: checkInCookie.value }, headers: nowHeader });
    expect(lookup.json()).toEqual([]);
  });

  it('also accepts an OPEN event on its Melbourne date', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: 'OPEN' } });
    const response = await submit();
    expect(response.statusCode).toBe(202);
    expect(await prisma.registration.count({ where: { eventId, status: 'PENDING' } })).toBe(1);
  });

  it('requires an authenticated Admin', async () => {
    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/day-of-registration`,
      headers: nowHeader, payload: input,
    });
    expect(response.statusCode).toBe(401);
  });

  it.each([
    { label: 'a DRAFT event', status: 'DRAFT', date: eventDate, closedAt: null },
    { label: 'the previous Melbourne date', status: 'CLOSED', date: new Date('2026-09-11T00:00:00.000Z'), closedAt: null },
    { label: 'the next Melbourne date', status: 'CLOSED', date: new Date('2026-09-13T00:00:00.000Z'), closedAt: null },
    { label: 'closed check-in', status: 'CLOSED', date: eventDate, closedAt: new Date('2026-09-11T14:00:00.000Z') },
  ])('rejects $label', async ({ status, date, closedAt }) => {
    await prisma.event.update({ where: { id: eventId }, data: { status: status as 'DRAFT' | 'CLOSED', eventDate: date, checkInClosedAt: closedAt } });
    const response = await submit();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'event_unavailable' });
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
    expect(payment.checkouts).toHaveLength(0);
  });

  it('uses normal registration validation', async () => {
    const response = await submit({ ...input, rank1Position: 'invalid' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_failed', fields: ['rank1Position'] });
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
  });

  it('retries a duplicate PENDING registration using the stored parent email', async () => {
    const first = await submit();
    const retry = await submit({ ...input, parentEmail: 'different@example.com' });
    const checkoutEmails = mailer.sent.filter((message) => message.subject === 'Continue your Netball Trials registration');

    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);
    expect(first.json()).toEqual(retry.json());
    expect(payment.checkouts).toHaveLength(1);
    expect(checkoutEmails.map((message) => message.to)).toEqual(['anne@example.com', 'anne@example.com']);
    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
  });

  it('returns a non-sensitive conflict for a duplicate PAID registration', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, {
        playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
        dateOfBirth: new Date('2012-04-02T00:00:00.000Z'), status: 'PAID', qrToken: 'paid-day-of-ticket-1234567890',
      }),
    });

    const response = await submit({ ...input, parentEmail: 'different@example.com' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'already_registered' });
    expect(JSON.stringify(response.json())).not.toMatch(/anne@example|different@example|registrationId|playerName/i);
    expect(payment.checkouts).toHaveLength(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('keeps a failed Checkout PENDING and allows the same request to retry', async () => {
    vi.spyOn(payment, 'createCheckout').mockRejectedValueOnce(new Error('provider unavailable'));
    const failed = await submit();
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ error: 'checkout_unavailable' });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const retried = await submit();
    expect(registration).toMatchObject({ status: 'PENDING', checkoutSessionId: null });
    expect(retried.statusCode).toBe(202);
    expect(await prisma.registration.count({ where: { eventId, status: 'PENDING' } })).toBe(1);
    expect(mailer.sent.some((message) => message.subject === 'Continue your Netball Trials registration')).toBe(true);
  });

  it('keeps a failed Checkout email PENDING and allows its continuation to retry', async () => {
    vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('mail unavailable'));
    const failed = await submit();
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ error: 'checkout_unavailable' });
    const registration = await prisma.registration.findFirstOrThrow({ where: { eventId } });
    const retried = await submit();
    expect(registration).toMatchObject({ status: 'PENDING' });
    expect(registration.checkoutSessionId).toMatch(fakeSessionIdPattern);
    expect(retried.statusCode).toBe(202);
    expect(await prisma.registration.count({ where: { eventId, status: 'PENDING' } })).toBe(1);
    const checkoutEmail = mailer.sent.find((message) => message.subject === 'Continue your Netball Trials registration');
    expect(checkoutEmail?.text).toContain(`https://checkout.test/${registration.checkoutSessionId}`);
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
