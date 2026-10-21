import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { consumeRateLimit, rateLimitClientKey, reserveRateLimit } from '../../security/rate-limit';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('database-backed API rate limiter', () => {
  it('atomically allows only the configured number of concurrent requests', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeRateLimit(prisma, 'hashed-client-key', now, 5, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: 'hashed-client-key' } })).hits).toBe(20);
  });

  it('starts a new fixed window after expiry', async () => {
    const firstWindow = new Date('2026-10-10T00:00:00Z');
    expect(await consumeRateLimit(prisma, 'hashed-client-key', firstWindow, 1, 60_000)).toBe(true);
    expect(await consumeRateLimit(prisma, 'hashed-client-key', new Date(firstWindow.getTime() + 60_001), 1, 60_000)).toBe(true);
  });
});

describe('conditional rate-limit reservations', () => {
  it('reserves atomically without incrementing denied concurrent requests', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveRateLimit(prisma, 'pin-event', now, 5, 60_000)),
    );
    expect(results.filter(Boolean)).toEqual(Array.from({ length: 5 }, () => now));
    expect(results.filter((result) => result === null)).toHaveLength(15);
    expect((await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: 'pin-event' } })).hits).toBe(5);
  });

  it('returns the actual reserved window and renews it only after expiry', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(await reserveRateLimit(prisma, 'pin-event', now, 2, 60_000)).toEqual(now);
    expect(await reserveRateLimit(prisma, 'pin-event', new Date(now.getTime() + 1), 2, 60_000)).toEqual(now);
    const full = await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: 'pin-event' } });
    expect(await reserveRateLimit(prisma, 'pin-event', new Date(now.getTime() + 59_999), 2, 60_000)).toBeNull();
    expect(await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: 'pin-event' } })).toEqual(full);
    const nextWindow = new Date(now.getTime() + 60_000);
    expect(await reserveRateLimit(prisma, 'pin-event', nextWindow, 2, 60_000)).toEqual(nextWindow);
    expect((await prisma.requestRateLimitBucket.findUniqueOrThrow({ where: { key: 'pin-event' } })).hits).toBe(1);
  });
});

describe('rateLimitClientKey', () => {
  it('ignores malformed IPv6 input instead of throwing', () => {
    expect(rateLimitClientKey('1:2:3:4:5:6:7:8:9::')).toBe('1:2:3:4:5:6:7:8:9::');
  });
  it('keeps IPv4 addresses whole', () => {
    expect(rateLimitClientKey('198.51.100.7')).toBe('198.51.100.7');
  });
  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(rateLimitClientKey('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(rateLimitClientKey('::FFFF:198.51.100.7')).toBe('198.51.100.7');
  });
  it('groups IPv6 addresses by /64 prefix', () => {
    expect(rateLimitClientKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitClientKey('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitClientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitClientKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitClientKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
  });
  it('falls back for missing or unparseable input', () => {
    expect(rateLimitClientKey(undefined)).toBe('unknown');
    expect(rateLimitClientKey('not-an-ip')).toBe('not-an-ip');
  });
});
