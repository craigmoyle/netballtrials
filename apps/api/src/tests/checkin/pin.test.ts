import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, isValidPinFormat } from '../../checkin/pin';
import { createPinLimiter } from '../../checkin/limiter';

describe('pin', () => {
  it('verifies the right pin and rejects the wrong one', () => {
    const stored = hashPin('4821');
    expect(verifyPin('4821', stored)).toBe(true);
    expect(verifyPin('4822', stored)).toBe(false);
  });
  it('accepts 4 to 8 digits only', () => {
    expect(isValidPinFormat('4821')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('12ab')).toBe(false);
  });
});

describe('pin limiter', () => {
  it('blocks after max failures inside the window and recovers after it', () => {
    const limiter = createPinLimiter({ max: 3, windowMs: 10 * 60_000 });
    const t0 = new Date('2026-10-07T00:00:00Z');
    for (let i = 0; i < 3; i++) {
      expect(limiter.allow('ip', t0)).toBe(true);
      limiter.fail('ip', t0);
    }
    expect(limiter.allow('ip', t0)).toBe(false);
    expect(limiter.allow('ip', new Date(t0.getTime() + 10 * 60_000 + 1))).toBe(true);
  });
});
