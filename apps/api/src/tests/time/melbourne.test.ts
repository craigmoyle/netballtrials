import { describe, expect, it } from 'vitest';
import { localDateTimeToUtc } from '../../time/melbourne';

describe('Melbourne local time conversion', () => {
  it('converts an existing wall time through the daylight-saving transition', () => {
    const date = new Date('2026-10-04T00:00:00.000Z');
    const instant = localDateTimeToUtc(date, '03:30');
    expect(instant.toISOString()).toBe('2026-10-03T16:30:00.000Z');
  });

  it('chooses the later occurrence of a repeated fall-back wall time', () => {
    const date = new Date('2026-04-05T00:00:00.000Z');
    expect(localDateTimeToUtc(date, '02:30').toISOString()).toBe('2026-04-04T16:30:00.000Z');
  });

  it('rejects a wall time skipped by the spring clock change', () => {
    expect(() => localDateTimeToUtc(new Date('2026-10-04T00:00:00.000Z'), '02:30'))
      .toThrow(/does not exist/i);
  });
});
