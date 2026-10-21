// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, apiClient } from './client';

afterEach(() => vi.restoreAllMocks());

describe('apiClient', () => {
  it.each([502, 429])('rejects a %i HTML error body with an ApiError carrying the status', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status, headers: { 'content-type': 'text/html' } }));

    const result = apiClient('http://api.test').listEvents();

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status, message: 'request_failed' });
  });

  it('rejects a successful non-JSON body as invalid_json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>proxy page</html>', { status: 200 }));

    await expect(apiClient('http://api.test').listEvents()).rejects.toMatchObject({ status: 200, message: 'invalid_json' });
  });

  it('starts an Admin-scoped event check-in session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"eventName":"Trials"}', { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(apiClient('http://api.test').openAdminCheckIn('event-1')).resolves.toEqual({ eventName: 'Trials' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/events/event-1/check-in/session', expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });

  it('deletes an event with session credentials and preserves the registration guard error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('{"error":"event_has_registrations"}', { status: 409, headers: { 'content-type': 'application/json' } }));
    const client = apiClient('http://api.test');

    await expect(client.deleteEvent('event-1')).resolves.toBeNull();
    await expect(client.deleteEvent('event-1')).rejects.toMatchObject({ status: 409, message: 'event_has_registrations' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/api/admin/events/event-1',
      'http://api.test/api/admin/events/event-1',
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials === 'include')).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
  });

  it('submits Admin-assisted day-of registration with session credentials', async () => {
    const input = { playerFirstName: 'Ada' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":"received"}', { status: 202, headers: { 'content-type': 'application/json' } }));

    await expect(apiClient('http://api.test').dayOfRegistration('event-1', input)).resolves.toEqual({ status: 'received' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/events/event-1/day-of-registration', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify(input),
    }));
  });

  it('preserves the optional fake simulation token from public registration', async () => {
    const response = { status: 'received', simulationToken: 'fake_session_opaque' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 202 }));
    const client = apiClient('http://api.test');

    const receipt = await client.register('event-1', { playerFirstName: 'Ada' });

    expect(receipt).toEqual(response);
    expect(receipt.simulationToken).toBe('fake_session_opaque');
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/public/events/event-1/registrations', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ playerFirstName: 'Ada' }),
    }));
  });

  it('posts the fake simulation token to the local completion endpoint', async () => {
    const result = { status: 'paid' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

    await expect(apiClient('http://api.test').completeFakePayment('fake_session_opaque')).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/public/fake-checkouts/complete', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ simulationToken: 'fake_session_opaque' }),
    }));
  });

  it('uses Admin endpoints for the color catalog and event court assignments', async () => {
    const color = { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null };
    const pair = { court: 1, teamAColor: color, teamBColor: { id: 'black', name: 'Black', hex: '#111111', archivedAt: null } };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([color]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(color), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...color, hex: '#EEEEEE' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([pair]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pair), { status: 200 }));
    const client = apiClient('http://api.test');

    await expect(client.listBibColors()).resolves.toEqual([color]);
    await expect(client.createBibColor({ name: 'Teal', hex: '#12AB34' })).resolves.toEqual(color);
    await expect(client.updateBibColor('white', { hex: '#EEEEEE' })).resolves.toMatchObject({ hex: '#EEEEEE' });
    await expect(client.archiveBibColor('white')).resolves.toBeNull();
    await expect(client.getCourtColors('event-1')).resolves.toEqual([pair]);
    await expect(client.setCourtColors('event-1', 1, { teamAColorId: 'white', teamBColorId: 'black' })).resolves.toEqual(pair);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/api/admin/bib-colors',
      'http://api.test/api/admin/bib-colors',
      'http://api.test/api/admin/bib-colors/white',
      'http://api.test/api/admin/bib-colors/white',
      'http://api.test/api/admin/events/event-1/court-colors',
      'http://api.test/api/admin/events/event-1/court-colors/1',
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials === 'include')).toBe(true);
    expect(JSON.parse((fetchMock.mock.calls[5][1] as RequestInit).body as string)).toEqual({ teamAColorId: 'white', teamBColorId: 'black' });
  });

  it('loads revision history, a revision, the paid checked-in roster and saves one round', async () => {
    const plan = { id: 'plan-2', revision: 2, status: 'PUBLISHED', slots: [], players: [], validationWarnings: [] };
    const history = [{ id: 'plan-2', revision: 2, status: 'PUBLISHED' }];
    const roster = [{ registrationId: 'player-1', playerName: 'Ada Lovelace', bibNumber: 7, rank1Position: 'GS', rank2Position: null, rank3Position: null, optInExtraPositions: false }];
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(history), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(roster), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 201 }));
    const client = apiClient('http://api.test') as any;
    const input = { sourcePlanId: 'plan-1', overrideWarnings: false, slots: [{ round: 2, court: 1, position: 'GS', team: 0, registrationId: 'player-1' }] };

    await expect(client.getPlanRevisions('event-1')).resolves.toEqual(history);
    await expect(client.getPlanRevision('event-1', 'plan-2')).resolves.toEqual(plan);
    await expect(client.getGameRoster('event-1')).resolves.toEqual(roster);
    await expect(client.saveManualRound('event-1', 2, input)).resolves.toEqual({ ok: true, plan });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/api/admin/events/event-1/plan/revisions',
      'http://api.test/api/admin/events/event-1/plan/revisions/plan-2',
      'http://api.test/api/admin/events/event-1/game-roster',
      'http://api.test/api/admin/events/event-1/plan/rounds/2/manual',
    ]);
    expect(JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string)).toEqual(input);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials === 'include')).toBe(true);
  });

  it('returns manual-plan validation warnings and preserves stale revisions as typed errors', async () => {
    const warning = { code: 'position_preference_warning', message: 'Check the player position.' };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'warnings_require_confirmation', warnings: [warning] }), { status: 422 }))
      .mockResolvedValueOnce(new Response('{"error":"stale_plan"}', { status: 409 }));
    const client = apiClient('http://api.test') as any;

    await expect(client.saveManualRound('event-1', 1, { sourcePlanId: 'plan-1', slots: [], overrideWarnings: false }))
      .resolves.toEqual({ ok: false, reason: 'warnings_required', warnings: [warning] });
    await expect(client.saveManualRound('event-1', 1, { sourcePlanId: 'plan-0', slots: [], overrideWarnings: false }))
      .rejects.toMatchObject({ status: 409, message: 'stale_plan' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes early-leaver IDs to automatic rebuilding and submits a complete manual suffix', async () => {
    const plan = { id: 'plan-2', revision: 2, status: 'DRAFT', slots: [], players: [], validationWarnings: [] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 201 }));
    const client = apiClient('http://api.test') as any;
    const suffix = { sourcePlanId: 'plan-1', fromRound: 3, removedRegistrationIds: ['player-7'], overrideWarnings: false,
      slots: [{ round: 3, court: 1, position: 'GS', team: 0, registrationId: 'player-8' }] };

    await expect(client.regeneratePlan('event-1', 3, ['player-7'])).resolves.toEqual({ ok: true, plan });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ fromRound: 3, removedRegistrationIds: ['player-7'] });
    await expect(client.saveManualSuffix('event-1', suffix)).resolves.toEqual({ ok: true, plan });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/api/admin/events/event-1/plan/regenerate',
      'http://api.test/api/admin/events/event-1/plan/suffix/manual',
    ]);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual(suffix);
  });

  it('fetches the public upcoming-trial list', async () => {
    const events = [{
      id: 'trial-1', name: '15/U Trials', division: '15/U', section: 'Ladies', eventDate: '2099-03-01T00:00:00.000Z',
      venue: 'SNC', startTime: '08:30', firstWhistle: '09:00', registrationFeeCents: 3500, currency: 'aud', status: 'OPEN',
    }];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(events), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(apiClient('http://api.test').listPublicEvents()).resolves.toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/public/events', expect.objectContaining({ credentials: 'include' }));
  });

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

  it('deletes an event with session credentials and preserves the registration guard error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('{"error":"event_has_registrations"}', { status: 409, headers: { 'content-type': 'application/json' } }));
    const client = apiClient('http://api.test');

    await expect(client.deleteEvent('event-1')).resolves.toBeNull();
    await expect(client.deleteEvent('event-1')).rejects.toMatchObject({ status: 409, message: 'event_has_registrations' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/api/admin/events/event-1',
      'http://api.test/api/admin/events/event-1',
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit).credentials === 'include')).toBe(true);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
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

  it('fetches the blank game sheet as HTML with session credentials', async () => {
    const html = '<!doctype html><section class="sheet">Blank</section>';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));

    await expect(apiClient('http://api.test').getBlankSheetHtml('event-1')).resolves.toBe(html);
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/admin/events/event-1/sheets/blank', expect.objectContaining({ credentials: 'include' }));
  });

  it('preserves selector-sheet API errors for color guidance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'court_colors_unassigned', courts: [2] }), { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').getSheetsHtml('event-1')).rejects.toMatchObject({ status: 409, message: 'court_colors_unassigned' });
  });

  it('rejects malformed JSON in a successful response as invalid_json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(apiClient('http://api.test').me()).rejects.toMatchObject({ name: 'ApiError', status: 200, message: 'invalid_json' });
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
