import { describe, expect, it } from 'vitest';
import { eventInputSchema, eventPatchSchema } from '../../events/schemas';

const event = {
  name: '15/U', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2026-09-12', venue: 'SNC', startTime: '08:30', endTime: '12:00',
  gameStartTime: '09:00', registrationFeeCents: 3500, courts: 4,
  rank1Min: 2, rank2Min: 1, rank3Min: 1, playMinutes: 8, changeoverMinutes: 2,
};

describe('event input boundaries', () => {
  it('rejects impossible calendar dates', () => {
    expect(eventInputSchema.safeParse({ ...event, eventDate: '2026-02-31' }).success).toBe(false);
  });

  it('accepts only HTTP or HTTPS policy URLs', () => {
    expect(eventInputSchema.safeParse({ ...event, policyUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...event, policyUrl: 'https://example.test/policy.pdf' }).success).toBe(true);
  });

  it('uses gameStartTime and rejects removed whistle fields', () => {
    expect(eventInputSchema.safeParse(event).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...event, firstWhistle: '09:00' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...event, lastWhistle: '11:30' }).success).toBe(false);
  });

  it('keeps creation duration defaults out of partial updates', () => {
    const { playMinutes: _play, changeoverMinutes: _changeover, ...withoutDurations } = event;
    expect(eventInputSchema.parse(withoutDurations)).toMatchObject({ playMinutes: 8, changeoverMinutes: 2 });
    expect(eventPatchSchema.parse({})).toEqual({});
    expect(eventPatchSchema.parse({ venue: 'Waverley' })).toEqual({ venue: 'Waverley' });
    expect(eventPatchSchema.parse({ playMinutes: 12, changeoverMinutes: 4 })).toEqual({ playMinutes: 12, changeoverMinutes: 4 });
    expect(eventPatchSchema.safeParse({ playMinutes: 0 }).success).toBe(false);
    expect(eventPatchSchema.safeParse({ changeoverMinutes: 11 }).success).toBe(false);
  });

  it('allows clearing a policy URL only on PATCH and still rejects unsafe URLs', () => {
    expect(eventPatchSchema.parse({ policyUrl: null })).toEqual({ policyUrl: null });
    expect(eventInputSchema.safeParse({ ...event, policyUrl: null }).success).toBe(false);
    expect(eventInputSchema.safeParse(event).success).toBe(true);
    for (const policyUrl of ['javascript:alert(1)', 'ftp://example.test/policy', '']) {
      expect(eventPatchSchema.safeParse({ policyUrl }).success).toBe(false);
      expect(eventInputSchema.safeParse({ ...event, policyUrl }).success).toBe(false);
    }
    for (const policyUrl of ['http://example.test/policy', 'https://example.test/policy.pdf']) {
      expect(eventPatchSchema.parse({ policyUrl })).toEqual({ policyUrl });
    }
  });

  it('uses policy age defaults when an administrator omits ages', () => {
    const { minAge: _min, maxAge: _max, ...withoutAges } = { ...event, minAge: 5, maxAge: 99 };
    expect(eventInputSchema.parse(withoutAges)).toMatchObject({ minAge: 12, maxAge: 15 });
    expect(eventInputSchema.parse({ ...withoutAges, division: '17/U' })).toMatchObject({ minAge: 14, maxAge: 17 });
    expect(eventInputSchema.parse({ ...withoutAges, division: 'Open' })).toMatchObject({ minAge: 15, maxAge: 99 });
    expect(eventInputSchema.parse({ ...withoutAges, division: 'All Abilities' })).toMatchObject({ minAge: 10, maxAge: 99 });
  });
});
