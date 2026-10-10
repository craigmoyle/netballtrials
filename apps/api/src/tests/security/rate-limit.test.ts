import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db';
import { consumeRateLimit } from '../../security/rate-limit';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('database-backed API rate limiter', () => {
  it('atomically allows only the configured number of concurrent requests', async () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeRateLimit(prisma, 'hashed-client-key', now, 5, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('starts a new fixed window after expiry', async () => {
    const firstWindow = new Date('2026-10-10T00:00:00Z');
    expect(await consumeRateLimit(prisma, 'hashed-client-key', firstWindow, 1, 60_000)).toBe(true);
    expect(await consumeRateLimit(prisma, 'hashed-client-key', new Date(firstWindow.getTime() + 60_001), 1, 60_000)).toBe(true);
  });
});
