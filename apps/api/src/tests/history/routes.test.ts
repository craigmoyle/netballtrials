import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'history-admin@example.com');
});

describe('Admin player history', () => {
  it('finds exact name/date-of-birth matches across retained events and returns only trial history', async () => {
    const earlier = await prisma.event.create({ data: eventFixture({ name: '15/U Trial', eventDate: new Date('2025-09-12T00:00:00Z') }) });
    const later = await prisma.event.create({ data: eventFixture({ name: '17/U Trial', competitionYear: 2027, eventDate: new Date('2026-09-12T00:00:00Z') }) });
    const expired = await prisma.event.create({ data: eventFixture({ name: 'Expired Trial', competitionYear: 2021, eventDate: new Date('2021-09-12T00:00:00Z') }) });
    const oldRegistration = await prisma.registration.create({ data: registrationFixture(earlier.id, {
      playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
      parentEmail: 'parent@example.test', status: 'PAID', checkedInAt: new Date(), bibNumber: 8,
      rank1Position: 'GS', rank2Position: 'GA', rank3Position: 'WA',
    }) });
    await prisma.registration.create({ data: registrationFixture(later.id, {
      playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace',
      parentEmail: 'parent@example.test', status: 'PAID', checkedInAt: null, bibNumber: null,
      rank1Position: 'C', rank2Position: 'WD', rank3Position: null,
    }) });
    await prisma.registration.create({ data: registrationFixture(expired.id, {
      playerFirstName: 'Ada', playerLastName: 'Lovelace', playerNameNormalized: 'ada lovelace', status: 'PAID',
    }) });
    const plan = await prisma.roundPlan.create({ data: {
      eventId: earlier.id, revision: 1, seed: 1, status: 'PUBLISHED', rounds: 1, courts: 1,
      playMinutes: 8, changeoverMinutes: 2, windowMinutes: 10, rank1Min: 1, rank2Min: 0, rank3Min: 0,
      eventName: earlier.name, eventDate: earlier.eventDate, venue: earlier.venue, gameStartTime: earlier.gameStartTime,
    } });
    await prisma.event.update({ where: { id: earlier.id }, data: { publishedPlanId: plan.id } });
    await prisma.roundSlot.createMany({ data: [
      { planId: plan.id, round: 1, court: 2, position: 'GS', team: 0, registrationId: oldRegistration.id },
      { planId: plan.id, round: 1, court: 2, position: 'GA', team: 1, registrationId: 'opponent-1' },
    ] });

    const result = await app.inject({
      method: 'GET', url: '/api/admin/player-history?playerName=Ada%20Lovelace&dateOfBirth=2011-04-02',
      cookies: { nt_session: cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toHaveLength(2);
    expect(result.json()[0]).toMatchObject({
      playerName: 'Ada Lovelace', eventName: '15/U Trial', competitionYear: 2027,
      number: 8, games: 1, courtsSeen: [2], positionsPlayed: { GS: 1 }, uniqueOpponents: 1,
      registrationStatus: 'PAID', checkedIn: true,
    });
    expect(result.json()[1]).toMatchObject({ eventName: '17/U Trial', games: 0, number: null, checkedIn: false });
    expect(JSON.stringify(result.json())).not.toMatch(/parent@example\.test|parentName|parentMobile|paymentIntentId|amountCents|dateOfBirth/i);

    const wrongDob = await app.inject({ method: 'GET', url: '/api/admin/player-history?playerName=Ada%20Lovelace&dateOfBirth=2012-04-02', cookies: { nt_session: cookie } });
    expect(wrongDob.json()).toEqual([]);
    const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/player-history?playerName=Ada%20Lovelace&dateOfBirth=2011-04-02' });
    expect(unauthorized.statusCode).toBe(401);
  });
});
