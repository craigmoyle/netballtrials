import type { PrismaClient } from '@prisma/client';
import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../app';

describe('GET /health', () => {
  it.each(['/health', '/api/health'])('returns ok from %s after checking the database', async (url) => {
    const query = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const app = createApp({ prisma: { $queryRaw: query } as unknown as PrismaClient });
    const res = await app.inject({ method: 'GET', url });
    expect(query).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', appEnv: 'testing', testAccessRequired: false });
    await app.close();
  });

  it('returns 503 when the database is unavailable', async () => {
    const app = createApp({
      prisma: { $queryRaw: vi.fn().mockRejectedValue(new Error('database unavailable')) } as unknown as PrismaClient,
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable', appEnv: 'testing', testAccessRequired: false });
    await app.close();
  });
});
