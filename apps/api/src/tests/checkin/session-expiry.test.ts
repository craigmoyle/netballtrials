import { describe, expect, it } from 'vitest';
import { checkInSessionExpiry } from '../../checkin/service';

describe('check-in session expiry', () => {
  it.each([
    ['AEST', '2026-09-12T00:00:00Z', '2026-09-13T13:59:59.999Z'],
    ['AEDT', '2026-12-12T00:00:00Z', '2026-12-13T12:59:59.999Z'],
  ])('expires at Melbourne local end of the following calendar day during %s', (_label, eventDate, expectedUtc) => {
    expect(checkInSessionExpiry(new Date(eventDate)).toISOString()).toBe(expectedUtc);
  });
});
