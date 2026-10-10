import { describe, expect, it } from 'vitest';
import { POSITIONS, melbourneDateKey } from '@netball-trials/types';
import { COURT_POSITIONS } from '../../planner/types';
import { eventFixture, registrationFixture } from './fixtures';

describe('shared domain helpers', () => {
  it('uses the same seven-position order for planner and shared UI types', () => {
    expect(COURT_POSITIONS).toEqual(POSITIONS);
  });

  it('formats dates in Melbourne time across AEST and AEDT', () => {
    expect(melbourneDateKey(new Date('2026-08-12T13:00:00Z'))).toBe('2026-08-12');
    expect(melbourneDateKey(new Date('2026-12-12T13:00:00Z'))).toBe('2026-12-13');
  });
});

describe('shared API test fixtures', () => {
  it('provides the canonical event setup used by integration tests', () => {
    expect(eventFixture()).toMatchObject({
      name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: new Date('2026-09-12T00:00:00.000Z'), venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 5,
      rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2, minAge: 12, maxAge: 15,
    });
  });

  it('provides a registration that can be safely overridden for a test case', () => {
    expect(registrationFixture('event-1')).toMatchObject({
      eventId: 'event-1', playerFirstName: 'Ada', playerLastName: 'Lovelace',
      playerNameNormalized: 'ada lovelace', parentEmail: 'anne@example.com', rank1Position: 'GS',
    });
  });
});
