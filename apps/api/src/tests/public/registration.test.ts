import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createFakePaymentProvider } from '../../payments/fake';
import { resetDb } from '../helpers/db';

let app: ReturnType<typeof createApp>;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  eventId = event.id;
  app = createApp({ payment: createFakePaymentProvider(), env: testEnv() });
});

const payload = {
  playerFirstName: 'Ada', playerLastName: 'Lovelace', dateOfBirth: '2011-04-02',
  parentName: 'Anne', parentEmail: 'anne@example.com', parentMobile: '0400000000',
  memberAssociation: 'MENA', rank1Position: 'GS', optInExtraPositions: false, eligibilityConfirmed: true,
};

describe('POST /api/public/events/:id/registrations', () => {
  it('creates a pending registration and returns a checkout url', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().checkoutUrl).toContain('checkout.test');
    const reg = await prisma.registration.findFirst();
    expect(reg?.status).toBe('PENDING');
  });
  it('returns 409 without confirming that a registration exists', async () => {
    await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    const res = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'duplicate' });
  });
  it('returns per-field errors for invalid input', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/public/events/${eventId}/registrations`, payload: { ...payload, rank1Position: 'XX' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });
});

function testEnv() {
  return {
    DATABASE_URL: '', WEB_ORIGIN: 'http://localhost:5173', API_PUBLIC_URL: 'http://localhost:3000',
    SESSION_COOKIE_SECURE: false, MAIL_FROM: 'a@b.com', MAIL_REPLY_TO: 'a@b.com',
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
