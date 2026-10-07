import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, newLoginToken, newSession } from '../../auth/tokens';

describe('auth tokens', () => {
  it('generates distinct tokens with at least 128 bits of entropy', () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(Buffer.from(a, 'base64url').length).toBeGreaterThanOrEqual(16);
  });
  it('hashes deterministically and never equals the raw token', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
  it('sets a 15 minute login TTL and a 30 day session TTL', () => {
    const now = new Date('2026-10-07T00:00:00.000Z');
    expect(newLoginToken(now).expiresAt.toISOString()).toBe('2026-10-07T00:15:00.000Z');
    expect(newSession(now).expiresAt.toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });
});
