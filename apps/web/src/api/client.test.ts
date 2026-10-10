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
  it('keeps the event-message batch ID and parses the full delivery summary', async () => {
    const summary = { batchId: '11111111-1111-4111-8111-111111111111', sent: 1, failed: 2, ambiguous: 0, pending: 0, deliveryIds: ['a', 'b', 'c'], sentThisRun: 1, failedThisRun: 2, ambiguousThisRun: 0 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(summary), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').sendMessage('event-1', { subject: 'Update', text: 'Details', batchId: summary.batchId })).resolves.toEqual(summary);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/admin/events/event-1/messages');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ subject: 'Update', text: 'Details', batchId: summary.batchId });
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
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/events/event-1/roster/export', expect.objectContaining({ credentials: 'include' }));
  });

  it('keeps retention-expired roster export as a typed error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"roster_retention_expired"}', { status: 410, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').downloadRoster('event-1')).rejects.toMatchObject({ status: 410, message: 'roster_retention_expired' });
  });

  it('preserves the planner 422 result as actionable gaps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"infeasible","gaps":[{"code":"too_few_players","message":"Need 28"}]}', { status: 422, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').generatePlan('event-1')).resolves.toEqual({
      ok: false, gaps: [{ code: 'too_few_players', message: 'Need 28' }],
    });
  });

  it('returns HTML sheets as text without JSON parsing', async () => {
    const html = '<!doctype html><section class="sheet">A &amp; B</section>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(apiClient('http://api.test').getSheetsHtml('event-1')).resolves.toBe(html);
  });

  it('keeps malformed JSON response behavior characterized', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').me()).rejects.toBeInstanceOf(SyntaxError);
  });

  it('converts fetch rejection to the network error contract', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await expect(apiClient('http://api.test').me()).rejects.toMatchObject({ status: 0, message: 'network_error' });
  });

  it('throws a typed error carrying field names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"validation_failed","fields":["lastWhistle"]}', { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').createEvent({} as any)).rejects.toMatchObject({ status: 400, fields: ['lastWhistle'] });
  });
});
