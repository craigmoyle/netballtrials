// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient } from './client';

afterEach(() => vi.restoreAllMocks());

describe('apiClient', () => {
  it('posts the email and always parses a 202', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":"sent"}', { status: 202, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').requestLink('a@example.com')).resolves.toEqual({ status: 'sent' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/auth/request-link', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });
  it('throws a typed error carrying field names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"validation_failed","fields":["lastWhistle"]}', { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').createEvent({} as any)).rejects.toMatchObject({ status: 400, fields: ['lastWhistle'] });
  });
});
