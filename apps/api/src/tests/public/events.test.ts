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

describe('GET /api/public/events', () => {
  it('returns an empty list when no upcoming public trials exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/public/events' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('lists future open and closed trials in date order but hides drafts and past events', async () => {
    await prisma.event.create({ data: { ...eventFixture({ name: 'Future Open', eventDate: new Date('2099-03-01T00:00:00.000Z') }), status: 'OPEN' } });
    await prisma.event.create({ data: { ...eventFixture({ name: 'Future Closed', eventDate: new Date('2099-02-01T00:00:00.000Z') }), status: 'CLOSED' } });
    await prisma.event.create({ data: { ...eventFixture({ name: 'Future Draft', eventDate: new Date('2099-01-01T00:00:00.000Z') }), status: 'DRAFT' } });
    await prisma.event.create({ data: { ...eventFixture({ name: 'Past Closed', eventDate: new Date('2000-01-01T00:00:00.000Z') }), status: 'CLOSED' } });

    const res = await app.inject({ method: 'GET', url: '/api/public/events' });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((event: { name: string; status: string }) => [event.name, event.status])).toEqual([
      ['Future Closed', 'CLOSED'],
      ['Future Open', 'OPEN'],
    ]);
    expect(res.json()[0]).not.toHaveProperty('policyDocumentName');
    expect(res.json()[0]).not.toHaveProperty('registrations');
  });
});
