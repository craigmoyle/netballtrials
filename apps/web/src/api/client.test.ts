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
  it('does not send an empty JSON body for no-payload admin actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"event-1","status":"OPEN"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await apiClient('http://api.test').openEvent('event-1');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).has('content-type')).toBe(false);
  });

  it('downloads the admin roster with session credentials and preserves the CSV body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Player name\\r\\nAda Lovelace\\r\\n', { status: 200 }));
    const blob = await apiClient('http://api.test').downloadRoster('event-1');
    expect(await blob.text()).toContain('Ada Lovelace');
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/events/event-1/roster/export', { credentials: 'include' });
  });

  it('keeps retention-expired roster export as a typed error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"roster_retention_expired"}', { status: 410, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').downloadRoster('event-1')).rejects.toMatchObject({ status: 410, message: 'roster_retention_expired' });
  });

  it('throws a typed error carrying field names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"validation_failed","fields":["lastWhistle"]}', { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').createEvent({} as any)).rejects.toMatchObject({ status: 400, fields: ['lastWhistle'] });
  });
});
