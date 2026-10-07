import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createFakePaymentProvider } from '../../payments/fake';
import { resetDb } from '../helpers/db';

let app: ReturnType<typeof createApp>;
let registrationId: string;

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  const reg = await prisma.registration.create({
    data: {
      eventId: event.id, playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
      dateOfBirth: new Date('2011-04-02T00:00:00Z'), parentName: 'Anne', parentEmail: 'anne@example.com',
      parentMobile: '0400000000', memberAssociation: 'MENA', rank1Position: 'GS', amountCents: 3500,
      policyReference: 'x', expiresAt: new Date(Date.now() + 86_400_000), paymentRef: 'cs_1',
      eligibilityConfirmedAt: new Date('2026-08-01T00:00:00Z'),
    },
  });
  registrationId = reg.id;
  app = createApp({ payment: createFakePaymentProvider() });
});

describe('stripe webhook', () => {
  it('rejects an invalid signature', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', payload: { bad: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_signature');
  });
  it('marks a registration paid once, issues a QR, and is idempotent', async () => {
    const fake = { kind: 'checkout_completed' as const, registrationId, sessionId: 'cs_1', amountCents: 3500, paymentRef: 'pi_1' };
    const res1 = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    const res2 = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    expect(res1.json().status).toBe('ok');
    expect(res2.json().status).toBe('ok');
    const reg = await prisma.registration.findUnique({ where: { id: registrationId } });
    expect(reg?.status).toBe('PAID');
    expect(reg?.qrToken).toHaveLength(43);
    expect(reg?.paidAt).not.toBeNull();
  });
  it('ignores a payment for an amount that does not match', async () => {
    const fake = { kind: 'checkout_completed' as const, registrationId, sessionId: 'cs_1', amountCents: 999, paymentRef: 'pi_1' };
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'stripe-signature': 'ok', 'content-type': 'application/json' }, payload: fake });
    expect(res.json().status).toBe('ignored');
    expect((await prisma.registration.findUnique({ where: { id: registrationId } }))?.status).toBe('PENDING');
  });
});

function eventFixture() {
  return {
    name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
    eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
    firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
    rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
  };
}
