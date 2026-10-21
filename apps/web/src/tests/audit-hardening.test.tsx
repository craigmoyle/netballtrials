import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { POSITIONS } from '@netball-trials/types';
import { App } from '../App';
import { ApiError } from '../api/client';

const api = vi.hoisted(() => ({} as Record<string, any>));
const camera = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('../api/client', async (original) => ({ ...await original(), apiClient: () => api }));
vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class {
  decodeFromVideoDevice(...args: any[]) { return camera.decode(...args); }
} }));
const routers: ReturnType<typeof createMemoryRouter>[] = [];
let decoded: (value: { getText(): string }) => void;
let stopCamera: ReturnType<typeof vi.fn>;
const event = {
  id: 'e1', name: 'Trials', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2027-09-12T00:00:00.000Z', venue: 'Original venue', startTime: '08:30', endTime: '12:00',
  gameStartTime: '09:00', registrationFeeCents: 3500, courts: 1,
  rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
  minAge: 12, maxAge: 15, policyUrl: 'https://example.invalid/old-policy', policyDocumentName: null, status: 'OPEN',
};
const players = Array.from({ length: 16 }, (_, i) => ({ registrationId: `p${i}`, playerName: `Player ${i}`, bibNumber: i + 1,
  rank1Position: POSITIONS[i % 7], rank2Position: null, rank3Position: null, optInExtraPositions: true, active: true }));
const plan = {
  id: 'plan1', eventId: 'e1', revision: 1, status: 'PUBLISHED', sourcePlanId: null, frozenThroughRound: 0,
  rounds: 2, courts: 1, players, validationWarnings: [], createdAt: '2027-08-01', publishedAt: '2027-08-01',
  slots: [1, 2].flatMap(round => POSITIONS.flatMap((position, i) => [0, 1].map(team => ({
    id: `${round}-${position}-${team}`, round, court: 1, team, position, ...players[i * 2 + team],
  })))),
};
function app(path: string) {
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [path] });
  routers.push(router);
  render(<RouterProvider router={router} />);
  return router;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  for (const key of Object.keys(api)) delete api[key];
  Object.assign(api, {
    me: vi.fn().mockResolvedValue({ user: { id: 'admin', email: 'a@example.invalid' } }),
    logout: vi.fn().mockResolvedValue(null), listEvents: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(event), getPublicEvent: vi.fn().mockResolvedValue(event),
    listPublicAssociations: vi.fn().mockResolvedValue([{ id: 'club', name: 'Club', active: true }]),
    listPublicEvents: vi.fn().mockResolvedValue([]),
    getPublishedPlan: vi.fn().mockResolvedValue(plan), getGameRoster: vi.fn().mockResolvedValue(players),
    getPlanRevisions: vi.fn().mockResolvedValue([]), getCourtColors: vi.fn().mockResolvedValue([]),
    checkInSummary: vi.fn().mockResolvedValue({ eventId: 'e1', eventName: 'Trials', registered: 10, checkedIn: 2, closed: false }),
    scan: vi.fn().mockResolvedValue({ result: 'checked_in', registrationId: 'p0', playerName: 'Player 0', bibNumber: 1 }),
    lookup: vi.fn().mockResolvedValue([{ id: 'p0', playerName: 'Player 0', checkedIn: false, bibNumber: null }]),
    manualCheckIn: vi.fn().mockResolvedValue({ result: 'checked_in', registrationId: 'p0', playerName: 'Player 0', bibNumber: 1 }),
    undoCheckIn: vi.fn().mockResolvedValue(null),
  });
  stopCamera = vi.fn();
  camera.decode.mockImplementation((_device, _video, cb) => { decoded = cb; return Promise.resolve({ stop: stopCamera }); });
});
afterEach(() => {
  cleanup(); routers.splice(0).forEach(router => router.dispose());
  window.sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); camera.decode.mockReset();
});

async function editRound() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit round 1' }));
  fireEvent.change(screen.getByLabelText('Player to move'), { target: { value: 'p0' } });
  fireEvent.change(screen.getByLabelText('Destination slot'), { target: { value: '1:1:GA:0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move or substitute' }));
}
async function editSuffix() {
  await screen.findByText('Active revision 1');
  fireEvent.click(screen.getByText('Roster changes'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));
  fireEvent.click(screen.getByLabelText('Remove Player 0 from round 1 onward'));
  fireEvent.click(screen.getByRole('button', { name: 'Manual replacements' }));
}

it.each(['registration', 'round', 'suffix', 'event'])('guards %s sign-out before logout, keeps canceled edits and confirms only once', async (kind) => {
  const router = app(`/admin/events/e1${kind === 'registration' ? '/day-of-registration' : kind === 'event' ? '' : '/games'}`);
  if (kind === 'registration') fireEvent.change(await screen.findByLabelText(/player first name/i), { target: { value: 'Unsaved child' } });
  else if (kind === 'event') fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved venue' } });
  else if (kind === 'round') await editRound();
  else await editSuffix();
  const location = router.state.location.pathname;
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(api.logout).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe(location);
  if (kind === 'registration') expect(screen.getByLabelText(/player first name/i)).toHaveValue('Unsaved child');
  else if (kind === 'event') expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved venue');
  else expect(screen.getByRole('heading', { name: kind === 'round' ? 'Edit round 1' : 'Manual replacements from round 1' })).toBeInTheDocument();
  expect(sessionStorage.length).toBe(0);
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
  expect(api.logout).toHaveBeenCalledTimes(1);
  expect(window.confirm).toHaveBeenCalledTimes(2);
});

it('locks interaction during sign-out, including when the form was clean at the click', async () => {
  const logout = deferred<null>();
  api.logout.mockReturnValue(logout.promise);
  app('/admin/events/e1/day-of-registration');
  const firstName = await screen.findByLabelText(/player first name/i);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(firstName.closest('[inert]')).not.toBeNull();
  fireEvent.change(firstName, { target: { value: 'Too late' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  fireEvent.click(screen.getByRole('link', { name: 'Events' }));
  expect(api.logout).toHaveBeenCalledTimes(1);
  await act(async () => logout.reject(new Error('offline')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not sign out/i);
  expect(firstName).toHaveValue('');
  expect(firstName.closest('[inert]')).toBeNull();
  fireEvent.change(firstName, { target: { value: 'Retry draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(api.logout).toHaveBeenCalledTimes(1);
});

it('prevents event edits during a pending save and preserves the submitted fields on failure', async () => {
  const save = deferred<unknown>();
  api.updateEvent = vi.fn().mockReturnValue(save.promise);
  app('/admin/events/e1');
  fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Submitted venue' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
  for (const group of ['Event details', 'Trial format', 'Selection settings']) expect(screen.getByRole('group', { name: group })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Late correction' } });
  expect(screen.getByLabelText('Venue')).toHaveValue('Submitted venue');
  await act(async () => save.reject(new Error('offline')));
  expect(screen.getByLabelText('Venue')).toBeEnabled();
  expect(screen.getByLabelText('Venue')).toHaveValue('Submitted venue');
  api.updateEvent.mockResolvedValue(event);
  fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
  await screen.findByRole('heading', { name: 'Events' });
  expect(api.updateEvent).toHaveBeenLastCalledWith('e1', expect.objectContaining({ venue: 'Submitted venue' }));
  expect(window.confirm).not.toHaveBeenCalled();
});

it('keeps suffix replacements correctable, unique and reflected in the preview and saved payload', async () => {
  api.saveManualSuffix = vi.fn().mockResolvedValue({ ok: true, plan: { ...plan, revision: 2 } });
  app('/admin/events/e1/games');
  await editSuffix();
  const label = 'Replacement for round 1, court 1, Team A, GS';
  const table = () => within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' }));
  expect(table().queryByText('Player 0')).not.toBeInTheDocument();
  expect(table().getByText('Unfilled')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(label), { target: { value: 'p14' } });
  expect(screen.getByLabelText(label)).toHaveValue('p14');
  expect(table().getByText('Player 14')).toBeInTheDocument();
  expect(within(screen.getByLabelText(label)).queryByRole('option', { name: 'Player 1 — Number 2' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(label), { target: { value: 'p15' } });
  expect(table().queryByText('Player 14')).not.toBeInTheDocument();
  expect(table().getByText('Player 15')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save manual suffix' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Replacement for round 2, court 1, Team A, GS'), { target: { value: 'p14' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual suffix' }));
  await waitFor(() => expect(api.saveManualSuffix).toHaveBeenCalledTimes(1));
  const payload = api.saveManualSuffix.mock.calls[0][1];
  expect(payload).toMatchObject({ sourcePlanId: 'plan1', fromRound: 1, removedRegistrationIds: ['p0'] });
  expect(payload.slots.find((slot: any) => slot.round === 1 && slot.position === 'GS' && slot.team === 0).registrationId).toBe('p15');
  for (const round of [1, 2]) expect(new Set(payload.slots.filter((slot: any) => slot.round === round).map((slot: any) => slot.registrationId)).size).toBe(14);
});

it.each([401, 403, 409])('ends a %s scan session after successful startup and stops the camera', async (status) => {
  api.scan.mockRejectedValue(new ApiError(status, status === 409 ? 'check_in_closed' : 'unauthorized'));
  const router = app('/check-in/scan');
  await screen.findByText('2 of 10 arrived');
  await waitFor(() => expect(camera.decode).toHaveBeenCalled());
  await act(async () => decoded({ getText: () => 'valid-player-token' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/check-in'));
  expect(stopCamera).toHaveBeenCalledTimes(1);
});

it.each(['lookup', 'manual', 'undo'])('ends an expired session during %s after startup', async (operation) => {
  const method = operation === 'lookup' ? 'lookup' : operation === 'manual' ? 'manualCheckIn' : 'undoCheckIn';
  api[method].mockRejectedValue(new ApiError(401, 'unauthorized'));
  const router = app('/check-in/lookup');
  await screen.findByText('2 of 10 arrived');
  fireEvent.change(screen.getByLabelText('Player name'), { target: { value: 'Player' } });
  if (operation !== 'lookup') fireEvent.click(await screen.findByRole('button', { name: 'Check in' }));
  if (operation === 'undo') fireEvent.click(await screen.findByRole('button', { name: 'Undo last check-in' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/check-in'));
});

it('stops the camera when scan undo discovers an expired session', async () => {
  api.undoCheckIn.mockRejectedValue(new ApiError(401, 'unauthorized'));
  const router = app('/check-in/scan');
  await waitFor(() => expect(camera.decode).toHaveBeenCalled());
  await act(async () => decoded({ getText: () => 'valid-player-token' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo last check-in' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/check-in'));
  await waitFor(() => expect(stopCamera).toHaveBeenCalledTimes(1));
});

it('keeps lookup usable when undo returns registration-not-found, not session-invalid', async () => {
  api.undoCheckIn.mockRejectedValue(new ApiError(404, 'not_found'));
  const router = app('/check-in/lookup');
  await screen.findByText('2 of 10 arrived');
  fireEvent.change(screen.getByLabelText('Player name'), { target: { value: 'Player' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Check in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo last check-in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not undo/i);
  expect(router.state.location.pathname).toBe('/check-in/lookup');
});

it('retains the last attendance count and retry on genuine scan network failure', async () => {
  api.scan.mockRejectedValue(new ApiError(0, 'network_error'));
  const router = app('/check-in/scan');
  await screen.findByText('2 of 10 arrived');
  await waitFor(() => expect(camera.decode).toHaveBeenCalled());
  await act(async () => decoded({ getText: () => 'valid-player-token' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry scan' }));
  await waitFor(() => expect(api.scan).toHaveBeenCalledTimes(2));
  expect(screen.getByText('2 of 10 arrived')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/check-in/scan');
  expect(stopCamera).not.toHaveBeenCalled();
});
