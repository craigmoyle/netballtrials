import { describe, it, expect } from 'vitest';
import { createApp } from '../app';

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = createApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
