import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

const app = createApp();

beforeEach(resetDb);

describe('public ticket', () => {
  it('returns the player name, event, and bib for a paid registration', async () => {
    const { token } = await seedPaid();
    const res = await app.inject({ method: 'GET', url: `/api/public/ticket/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().playerName).toBe('Ada Lovelace');
    expect(res.json()).not.toHaveProperty('parentEmail');
  });
  it('returns 404 for an unpaid registration token', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const reg = await prisma.registration.create({ data: { ...regFixture(event.id), status: 'PENDING', qrToken: null } });
    const res = await app.inject({ method: 'GET', url: `/api/public/ticket/${reg.id}` });
    expect(res.statusCode).toBe(404);
  });
});

async function seedPaid() {
  const event = await prisma.event.create({ data: eventFixture() });
  const token = 'a'.repeat(43);
  await prisma.registration.create({ data: { ...regFixture(event.id), status: 'PAID', qrToken: token } });
  return { token };
}

function eventFixture() {
  return {
    name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
    eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
    firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
    rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
  };
}

function regFixture(eventId: string) {
  return {
    eventId, playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
    dateOfBirth: new Date('2011-04-02T00:00:00.000Z'), parentName: 'Anne', parentEmail: 'anne@example.com',
    parentMobile: '0400000000', memberAssociation: 'MENA', rank1Position: 'GS' as const,
    eligibilityConfirmedAt: new Date('2026-08-01T00:00:00.000Z'),
    amountCents: 3500, policyReference: 'https://chisholmnetball.com/selection-policy/', expiresAt: new Date(Date.now() + 86_400_000),
  };
}
