import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';

const app = createApp();

beforeEach(resetDb);

describe('GET /api/public/events/:id', () => {
  it('returns public details for an open event without contact data', async () => {
    const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
    const res = await app.inject({ method: 'GET', url: `/api/public/events/${event.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('15/U Ladies');
    expect(body.competitionYear).toBe(2027);
    expect(body.startTime).toBe('08:30');
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
