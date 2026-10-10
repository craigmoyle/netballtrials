import { describe, expect, it } from 'vitest';
import { eventInputSchema } from '../../events/schemas';

const event = {
  name: '15/U', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2026-09-12', venue: 'SNC', startTime: '08:30', endTime: '12:00',
  firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 4,
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

  it('uses policy age defaults when an administrator omits ages', () => {
    const { minAge: _min, maxAge: _max, ...withoutAges } = { ...event, minAge: 5, maxAge: 99 };
    expect(eventInputSchema.parse(withoutAges)).toMatchObject({ minAge: 12, maxAge: 15 });
    expect(eventInputSchema.parse({ ...withoutAges, division: '17/U' })).toMatchObject({ minAge: 14, maxAge: 17 });
    expect(eventInputSchema.parse({ ...withoutAges, division: 'Open' })).toMatchObject({ minAge: 15, maxAge: 99 });
    expect(eventInputSchema.parse({ ...withoutAges, division: 'All Abilities' })).toMatchObject({ minAge: 10, maxAge: 99 });
  });
});
