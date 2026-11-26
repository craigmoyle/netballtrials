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
      eventId: earlier.id, revision: 1, seed: 1, status: 'PUBLISHED', rounds: 2, courts: 2,
      playMinutes: 8, changeoverMinutes: 2, windowMinutes: 10, rank1Min: 1, rank2Min: 0, rank3Min: 0,
      eventName: earlier.name, eventDate: earlier.eventDate, venue: earlier.venue, gameStartTime: earlier.gameStartTime,
    } });
    await prisma.event.update({ where: { id: earlier.id }, data: { publishedPlanId: plan.id } });
    await prisma.roundSlot.createMany({ data: [
      { planId: plan.id, round: 1, court: 2, position: 'GS', team: 0, registrationId: oldRegistration.id },
      { planId: plan.id, round: 1, court: 2, position: 'GA', team: 1, registrationId: 'opponent-1' },
      { planId: plan.id, round: 2, court: 1, position: 'GA', team: 1, registrationId: oldRegistration.id },
    ] });

    const result = await app.inject({
      method: 'GET', url: '/api/admin/player-history?playerName=Ada%20Lovelace&dateOfBirth=2011-04-02',
      cookies: { nt_session: cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().entries).toHaveLength(2);
    expect(result.json().truncated).toBe(false);
    expect(result.json().entries[0]).toMatchObject({
      playerName: 'Ada Lovelace', eventName: '15/U Trial', competitionYear: 2027,
      number: 8, games: 2, courtsSeen: [1, 2], positionsPlayed: { GS: 1, GA: 1 }, uniqueOpponents: 1,
      appearances: [
        { round: 1, court: 2, team: 0, position: 'GS' },
        { round: 2, court: 1, team: 1, position: 'GA' },
      ],
      registrationStatus: 'PAID', checkedIn: true,
    });
    expect(result.json().entries[1]).toMatchObject({ eventName: '17/U Trial', games: 0, number: null, checkedIn: false });
    expect(JSON.stringify(result.json())).not.toMatch(/parent@example\.test|parentName|parentMobile|paymentIntentId|amountCents|dateOfBirth/i);

    const wrongDob = await app.inject({ method: 'GET', url: '/api/admin/player-history?playerName=Ada%20Lovelace&dateOfBirth=2012-04-02', cookies: { nt_session: cookie } });
    expect(wrongDob.json()).toEqual({ entries: [], truncated: false });
    const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/player-history?playerName=Ada%20Lovelace&dateOfBirth=2011-04-02' });
    expect(unauthorized.statusCode).toBe(401);
  });

  it('returns the newest 50 retained matches without letting expired rows consume the limit', async () => {
    for (let index = 0; index < 50; index += 1) {
      const event = await prisma.event.create({ data: eventFixture({ name: `Expired ${index}`, eventDate: new Date('2020-01-01T00:00:00Z') }) });
      await prisma.registration.create({ data: registrationFixture(event.id, {
        playerFirstName: 'Cap', playerLastName: 'Player', playerNameNormalized: 'cap player', status: 'PAID',
      }) });
    }
    const retained = await prisma.event.create({ data: eventFixture({ name: 'Retained', eventDate: new Date('2026-01-01T00:00:00Z') }) });
    await prisma.registration.create({ data: registrationFixture(retained.id, {
      playerFirstName: 'Cap', playerLastName: 'Player', playerNameNormalized: 'cap player', status: 'PAID',
    }) });

    const result = await app.inject({
      method: 'GET', url: '/api/admin/player-history?playerName=Cap%20Player&dateOfBirth=2011-04-02',
      cookies: { nt_session: cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ entries: [expect.objectContaining({ eventName: 'Retained' })], truncated: false });

    for (let index = 0; index < 50; index += 1) {
      const event = await prisma.event.create({ data: eventFixture({ name: `Retained ${index}`, eventDate: new Date(Date.UTC(2023, index % 12, 1 + (index % 20))) }) });
      await prisma.registration.create({ data: registrationFixture(event.id, {
        playerFirstName: 'Cap', playerLastName: 'Player', playerNameNormalized: 'cap player', status: 'PAID',
      }) });
    }
    const capped = await app.inject({
      method: 'GET', url: '/api/admin/player-history?playerName=Cap%20Player&dateOfBirth=2011-04-02',
      cookies: { nt_session: cookie },
    });
    expect(capped.json().entries).toHaveLength(50);
    expect(capped.json().truncated).toBe(true);
    expect(capped.json().entries.at(-1).eventName).toBe('Retained');
  });
});
