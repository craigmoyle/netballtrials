import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

const app = createApp();

beforeEach(resetDb);

describe('GET /api/public/events/:id', () => {
  it('returns public details for an open event without contact data', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
    const res = await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('15/U Ladies');
    expect(body.minAge).toBe(12);
    expect(body.registrationFeeCents).toBe(3500);
    expect(body).not.toHaveProperty('policyDocumentName');
  });
  it('hides a draft event', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), status: 'DRAFT' } });
    const res = await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` });
    expect(res.statusCode).toBe(404);
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
