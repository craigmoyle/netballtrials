import { describe, it, expect } from 'vitest';
import { createApp } from '../app';

describe('GET /health', () => {
  it.each(['/health', '/api/health'])('returns ok from %s', async (url) => {
    const app = createApp();
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', appEnv: 'testing' });
    await app.close();
  });
});
