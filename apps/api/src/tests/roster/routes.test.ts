import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
  eventId = (await prisma.event.create({ data: eventFixture({ status: 'OPEN' }) })).id;
});

describe('admin roster routes', () => {
  it('requires an admin session and returns limited roster plus position-choice counts', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, {
        playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
        rank1Position: 'GS', rank2Position: 'WA', optInExtraPositions: true, status: 'PAID', bibNumber: 4,
      }),
    });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster` })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      positionCounts: { rank1: { GS: 1 }, rank2: { WA: 1 }, extraOptIn: 1 },
      registrations: [{ playerName: 'Ada Lovelace', parentEmail: 'anne@example.com', bibNumber: 4 }],
    });
    expect(JSON.stringify(response.json())).not.toContain('qrToken');
  });

  it('exports an admin-only formula-neutralized CSV', async () => {
    await prisma.registration.create({
      data: registrationFixture(eventId, {
        playerFirstName: '=HYPERLINK("https://evil.example")', playerLastName: 'Ng, Jr',
        playerNameNormalized: 'formula player', parentName: '@SUM(1)', parentEmail: 'parent@example.com', memberAssociation: 'Ng, Jr',
        status: 'PAID',
      }),
    });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster/export` })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/roster/export`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('.csv');
    expect(response.body).toContain("'=HYPERLINK(");
    expect(response.body).toContain("'@SUM(1)");
    expect(response.body).toContain('"Ng, Jr"');
    expect(response.body).not.toMatch(/qrToken|paymentIntentId|checkoutSessionId/);
  });

  it('stops exporting after the retention cutoff', async () => {
    const old = await prisma.event.create({ data: eventFixture({ eventDate: new Date('2024-01-01T00:00:00Z') }) });
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${old.id}/roster/export`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: 'roster_retention_expired' });
  });
});
