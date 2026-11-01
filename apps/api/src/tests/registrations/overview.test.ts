import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { getRegistrationOverview } from '../../registrations/overview';
import { localDateTimeToUtc } from '../../time/melbourne';

const app = createApp();
let cookie: string;
const now = new Date('2027-09-01T00:00:00.000Z');
let playerIndex = 0;

function registration(eventId: string, overrides: Record<string, unknown> = {}) {
  const name = `Player ${++playerIndex}`;
  return registrationFixture(eventId, { playerFirstName: name, playerNameNormalized: name.toLowerCase(), ...overrides });
}

beforeEach(async () => {
  await resetDb();
  playerIndex = 0;
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

describe('registration overview', () => {
  it('counts current paid and pending registrations and compares paid counts at the same lead time', async () => {
    const current = await prisma.event.create({ data: eventFixture({
      name: '15/U Ladies 2027', competitionYear: 2027, eventDate: new Date('2027-09-12T00:00:00.000Z'), status: 'OPEN',
    }) as never });
    const previous = await prisma.event.create({ data: eventFixture({
      name: '15/U Ladies 2026', competitionYear: 2026, eventDate: new Date('2026-09-12T00:00:00.000Z'), status: 'CLOSED',
    }) as never });
    const otherDivision = await prisma.event.create({ data: eventFixture({
      name: '17/U Ladies 2026', competitionYear: 2026, division: '17/U', eventDate: new Date('2026-09-12T00:00:00.000Z'), status: 'CLOSED',
    }) as never });
    const historyCutoff = new Date(localDateTimeToUtc(previous.eventDate, previous.startTime).getTime() -
      (localDateTimeToUtc(current.eventDate, current.startTime).getTime() - now.getTime()));

    await prisma.registration.create({ data: registration(previous.id, { status: 'PAID', paidAt: new Date(historyCutoff.getTime() - 1) }) });
    await prisma.registration.create({ data: registration(previous.id, { status: 'PAID', paidAt: new Date(historyCutoff.getTime() + 1) }) });
    await prisma.registration.create({ data: registration(otherDivision.id, { status: 'PAID', paidAt: new Date(historyCutoff.getTime() - 1) }) });
    await prisma.registration.create({ data: registration(current.id, { status: 'PAID', paidAt: new Date(now.getTime() - 60_000) }) });
    await prisma.registration.create({ data: registration(current.id, { status: 'WITHDRAWN', paidAt: new Date(now.getTime() - 30_000) }) });
    await prisma.registration.create({ data: registration(current.id, { status: 'PENDING', expiresAt: new Date(now.getTime() + 60_000) }) });
    await prisma.registration.create({ data: registration(current.id, { status: 'PENDING', expiresAt: new Date(now.getTime() - 60_000) }) });

    const result = await getRegistrationOverview(prisma, now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: current.id,
      paidRegistrations: 1,
      paidWithdrawals: 1,
      pendingRegistrations: 1,
      daysUntilStart: 11,
      priorYears: [{ competitionYear: 2026, paidRegistrationsAtSameLeadTime: 1 }],
    });
  });

  it('protects the aggregate endpoint and returns an empty list when there are no open events', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/registration-overview' })).statusCode).toBe(401);
    const response = await app.inject({ method: 'GET', url: '/api/admin/registration-overview', cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});
