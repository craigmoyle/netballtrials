import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider, useParams } from 'react-router-dom';
import { POSITIONS, type EventCourtColorDTO, type GamePlayerDTO, type PlanRevisionSummaryDTO, type RoundPlanDTO, type RoundPlanPlayerDTO, type RoundSlotDTO } from '@netball-trials/types';
import { ApiError } from '../api/client';
import { FullGameListPage } from './FullGameListPage';

const testRouters: ReturnType<typeof createMemoryRouter>[] = [];

afterEach(() => {
  cleanup();
  for (const router of testRouters) router.dispose();
  testRouters.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const event = {
  id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
  gameStartTime: '09:00', registrationFeeCents: 3500, courts: 2,
  rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
  minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
};

function makePlayers(): RoundPlanPlayerDTO[] {
  return Array.from({ length: 28 }, (_, index) => ({
    registrationId: `player-${index}`,
    playerName: `Player ${index + 1}`,
    bibNumber: index + 1,
    rank1Position: POSITIONS[index % POSITIONS.length],
    rank2Position: null,
    rank3Position: null,
    optInExtraPositions: true,
    active: true,
  }));
}

function makePlan(overrides: Partial<RoundPlanDTO> = {}): RoundPlanDTO {
  const players = makePlayers();
  const slots: RoundSlotDTO[] = [];
  for (let round = 1; round <= 2; round += 1) {
    for (let court = 1; court <= 2; court += 1) {
      for (const [positionIndex, position] of POSITIONS.entries()) {
        for (const team of [0, 1]) {
          const placeIndex = (court - 1) * 14 + positionIndex * 2 + team;
          const player = players[(placeIndex + (round - 1) * 14) % players.length];
          slots.push({
            id: `slot-${round}-${court}-${position}-${team}`, round, court, position, team,
            registrationId: player.registrationId, playerName: player.playerName, bibNumber: player.bibNumber,
          });
        }
      }
    }
  }
  return {
    id: 'plan-1', eventId: event.id, status: 'PUBLISHED', revision: 1, sourcePlanId: null, frozenThroughRound: 0,
    seed: 1, rounds: 2, courts: 2, playMinutes: 8, changeoverMinutes: 2, windowMinutes: 150,
    rank1Min: 1, rank2Min: 0, rank3Min: 0, eventName: event.name, eventDate: event.eventDate,
    venue: event.venue, gameStartTime: event.gameStartTime, createdAt: '2027-08-01T00:00:00.000Z',
    publishedAt: '2027-08-01T00:00:00.000Z', slots, players, validationWarnings: [], ...overrides,
  };
}

const plan = makePlan({ revision: 2, sourcePlanId: 'plan-0' });
const roster: GamePlayerDTO[] = plan.players.map((player) => ({
  registrationId: player.registrationId, playerName: player.playerName, bibNumber: player.bibNumber!,
  rank1Position: player.rank1Position, rank2Position: player.rank2Position, rank3Position: player.rank3Position,
  optInExtraPositions: player.optInExtraPositions,
}));
const colors: EventCourtColorDTO[] = [
  { court: 1, teamAColor: { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null }, teamBColor: { id: 'black', name: 'Black', hex: '#111111', archivedAt: null } },
  { court: 2, teamAColor: { id: 'grey', name: 'Grey', hex: '#777777', archivedAt: null }, teamBColor: { id: 'orange', name: 'Orange', hex: '#F28C28', archivedAt: null } },
];
const revisions: PlanRevisionSummaryDTO[] = [
  { id: 'plan-1', revision: 2, status: 'PUBLISHED', sourcePlanId: 'plan-0', frozenThroughRound: 0, createdAt: '2027-08-02T00:00:00.000Z', publishedAt: '2027-08-02T00:00:00.000Z', validationWarnings: [] },
  { id: 'plan-0', revision: 1, status: 'PUBLISHED', sourcePlanId: null, frozenThroughRound: 0, createdAt: '2027-08-01T00:00:00.000Z', publishedAt: '2027-08-01T00:00:00.000Z', validationWarnings: [] },
];

const reportNames = ['Player One', 'Player Two', 'Position Mismatch', 'Early Leaver', 'Player Five', 'Player Six', 'Player Seven', 'Player Eight', 'Player Nine', 'Player Ten', 'Player Eleven', 'Player Twelve', 'Player Thirteen', 'Player Fourteen', 'Reserve Player', 'Resting Player'];
const reportPreferences = ['GS', 'GA', 'WD', 'C', 'GK', 'GS', 'GA', 'WA', 'WA', 'C', 'WD', 'GD', 'GD', 'GK', 'GA', 'WA'] as const;
const reportPlayers: RoundPlanPlayerDTO[] = reportNames.map((playerName, index) => ({
  registrationId: `report-player-${index + 1}`,
  playerName,
  bibNumber: index + 1,
  rank1Position: reportPreferences[index],
  rank2Position: index === 1 ? 'GS' : null,
  rank3Position: null,
  optInExtraPositions: true,
  active: index !== 3,
}));
const reportAssignments: Array<{ round: number; positions: Record<(typeof POSITIONS)[number], readonly [string, string]> }> = [
  { round: 1, positions: { GS: ['report-player-1', 'report-player-6'], GA: ['report-player-2', 'report-player-7'], WA: ['report-player-8', 'report-player-9'], C: ['report-player-4', 'report-player-10'], WD: ['report-player-11', 'report-player-12'], GD: ['report-player-13', 'report-player-14'], GK: ['report-player-3', 'report-player-5'] } },
  { round: 2, positions: { GS: ['report-player-1', 'report-player-2'], GA: ['report-player-3', 'report-player-6'], WA: ['report-player-7', 'report-player-8'], C: ['report-player-9', 'report-player-10'], WD: ['report-player-11', 'report-player-12'], GD: ['report-player-13', 'report-player-14'], GK: ['report-player-5', 'report-player-15'] } },
];
const reportSlots: RoundSlotDTO[] = reportAssignments.flatMap(({ round, positions }) =>
  POSITIONS.flatMap((position) => positions[position].map((registrationId, team) => {
    const player = reportPlayers.find((candidate) => candidate.registrationId === registrationId)!;
    return {
      id: `report-slot-${round}-${position}-${team}`, round, court: 1, position, team,
      registrationId, playerName: player.playerName, bibNumber: player.bibNumber,
    };
  })),
);
const lateReportPlayer: GamePlayerDTO = {
  registrationId: 'report-late', playerName: 'Late Arrival', bibNumber: 99, rank1Position: 'GA',
  rank2Position: null, rank3Position: null, optInExtraPositions: true,
};
const reportRoster: GamePlayerDTO[] = [
  ...reportPlayers.map(({ registrationId, playerName, bibNumber, rank1Position, rank2Position, rank3Position, optInExtraPositions }) => ({
    registrationId, playerName, bibNumber: bibNumber!, rank1Position, rank2Position, rank3Position, optInExtraPositions,
  })),
  lateReportPlayer,
];
const reportPlan = makePlan({ id: 'report-plan', revision: 2, sourcePlanId: 'plan-0', rounds: 2, courts: 1, players: reportPlayers, slots: reportSlots });

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    getEvent: vi.fn().mockResolvedValue(event),
    getPublishedPlan: vi.fn().mockResolvedValue(plan),
    getGameRoster: vi.fn().mockResolvedValue(roster),
    getPlanRevisions: vi.fn().mockResolvedValue(revisions),
    getPlanRevision: vi.fn().mockResolvedValue(makePlan({ id: 'plan-0', revision: 1, sourcePlanId: null })),
    getCourtColors: vi.fn().mockResolvedValue(colors),
    saveManualRound: vi.fn().mockResolvedValue({ ok: true, plan }),
    regeneratePlan: vi.fn().mockResolvedValue({ ok: true, plan: makePlan({ id: 'draft-3', status: 'DRAFT', revision: 3, sourcePlanId: plan.id }) }),
    saveManualSuffix: vi.fn().mockResolvedValue({ ok: true, plan }),
    ...overrides,
  };
}

function RoutedGameList({ client }: { client: Record<string, unknown> }) {
  const { eventId } = useParams();
  return <><Link to="/leave-schedule">Leave Full Game List</Link><FullGameListPage client={client as any} eventId={eventId ?? 'event-1'} /></>;
}

function renderPageWithRouter(client = makeClient(), eventId = 'event-1') {
  const router = createMemoryRouter([
    { path: '/admin/events/:eventId/games', element: <RoutedGameList client={client} /> },
    { path: '/leave-schedule', element: <h1>Left schedule</h1> },
  ], { initialEntries: [`/admin/events/${eventId}/games`] });
  testRouters.push(router);
  render(<RouterProvider router={router} />);
  return router;
}

function renderPage(client = makeClient()) {
  renderPageWithRouter(client);
  return client;
}

function editRoundOne() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit round 1' }));
}

function makeMove(playerId = 'player-0', target = '1:1:GA:0') {
  editRoundOne();
  fireEvent.change(screen.getByLabelText('Player to move'), { target: { value: playerId } });
  fireEvent.change(screen.getByLabelText('Destination slot'), { target: { value: target } });
  fireEvent.click(screen.getByRole('button', { name: 'Move or substitute' }));
}

function openRosterChanges() {
  const summary = screen.getByText('Roster changes');
  if (!summary.closest('details')?.open) fireEvent.click(summary);
}

describe('FullGameListPage', () => {
  it('keeps the page heading stable while the published schedule loads', async () => {
    let resolveEvent!: (loadedEvent: typeof event) => void;
    const pendingEvent = new Promise<typeof event>((resolve) => { resolveEvent = resolve; });
    const client = makeClient({ getEvent: vi.fn(() => pendingEvent), getPublishedPlan: vi.fn().mockResolvedValue(null), getPlanRevisions: vi.fn().mockResolvedValue([]) });
    renderPage(client);
    const heading = screen.getByRole('heading', { name: 'Full Game List' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading game list...');

    resolveEvent(event);
    await screen.findByText('No published game plan yet.');
    expect(screen.getByRole('heading', { name: 'Full Game List' })).toBe(heading);
  });

  it('warns before leaving dirty schedule edits and preserves them if navigation is canceled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const router = renderPageWithRouter();
    await screen.findByText('Active revision 2');

    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    makeMove();
    expect(screen.getByRole('button', { name: 'Save round 1' })).toBeEnabled();
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    expect(setItem).not.toHaveBeenCalled();

    const leave = screen.getByRole('link', { name: 'Leave Full Game List' });
    fireEvent.click(leave);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe('/admin/events/event-1/games');
    expect(screen.getByRole('button', { name: 'Save round 1' })).toBeEnabled();

    fireEvent.click(leave);
    expect(await screen.findByRole('heading', { name: 'Left schedule' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/leave-schedule');
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('allows clean Full Game List navigation without a confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const router = renderPageWithRouter();
    await screen.findByRole('heading', { name: 'Full Game List' });

    fireEvent.click(screen.getByRole('link', { name: 'Leave Full Game List' }));

    expect(await screen.findByRole('heading', { name: 'Left schedule' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/leave-schedule');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('clears the previous event context while a different event loads', async () => {
    let holdSecondEvent!: Promise<typeof event>;
    const client = makeClient();
    const router = renderPageWithRouter(client);
    await screen.findByText('Active revision 2');
    holdSecondEvent = new Promise<typeof event>(() => undefined);
    client.getEvent.mockReturnValueOnce(holdSecondEvent);

    await router.navigate('/admin/events/event-2/games');

    expect(await screen.findByRole('status')).toHaveTextContent('Loading game list...');
    expect(screen.queryByText('15/U Ladies')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View revision 1' })).not.toBeInTheDocument();
  });

  it('does not apply a save response to a different event after navigation', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    let resolveSave!: (result: { ok: true; plan: RoundPlanDTO }) => void;
    const delayedSave = new Promise<{ ok: true; plan: RoundPlanDTO }>((resolve) => { resolveSave = resolve; });
    const nextEvent = { ...event, id: 'event-2', name: 'New Event', division: '17/U' };
    const nextPlan = makePlan({ id: 'plan-3', eventId: 'event-2', eventName: nextEvent.name, revision: 3, sourcePlanId: 'plan-1' });
    const client = makeClient({
      getEvent: vi.fn().mockResolvedValueOnce(event).mockResolvedValueOnce(nextEvent),
      getPublishedPlan: vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(nextPlan),
      saveManualRound: vi.fn(() => delayedSave),
    });
    const router = renderPageWithRouter(client);
    await screen.findByText('Active revision 2');
    makeMove();
    fireEvent.click(screen.getByRole('button', { name: 'Save round 1' }));
    await waitFor(() => expect(client.saveManualRound).toHaveBeenCalledTimes(1));

    await router.navigate('/admin/events/event-2/games');
    await screen.findByText('Active revision 3');
    resolveSave({ ok: true, plan });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('New Event')).toBeInTheDocument();
    expect(screen.getByText('Active revision 3')).toBeInTheDocument();
    expect(screen.queryByText('Revision 2 is now active.')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'])('ignores a delayed history %s after switching A to B and back to A', async (outcome) => {
    let resolveHistory!: (value: RoundPlanDTO) => void;
    let rejectHistory!: (reason: Error) => void;
    const history = new Promise<RoundPlanDTO>((resolve, reject) => { resolveHistory = resolve; rejectHistory = reject; });
    const client = makeClient({ getPlanRevision: vi.fn(() => history) });
    const router = renderPageWithRouter(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Revision history' }));
    fireEvent.click(screen.getByRole('button', { name: 'View revision 1' }));
    expect(client.getPlanRevision).toHaveBeenCalledWith('event-1', 'plan-0');

    await act(async () => { await router.navigate('/admin/events/event-2/games'); });
    await screen.findByText('Active revision 2');
    await act(async () => { await router.navigate('/admin/events/event-1/games'); });
    await screen.findByText('Active revision 2');
    makeMove();

    await act(async () => {
      if (outcome === 'success') resolveHistory(makePlan({ id: 'plan-0', revision: 1 }));
      else rejectHistory(new Error('offline'));
    });

    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save round 1' })).toBeEnabled();
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).getByRole('row', { name: /GS Player 3/ })).toBeInTheDocument();
  });

  it('groups rounds, courts, Team A/B and positions, showing color names and player Numbers', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });
    await screen.findByRole('table', { name: 'Round 1, Court 1, Team A' });

    expect(screen.getAllByRole('table').slice(0, 4).map((table) => within(table).getByRole('caption').textContent)).toEqual([
      'Round 1, Court 1, Team A', 'Round 1, Court 1, Team B', 'Round 1, Court 2, Team A', 'Round 1, Court 2, Team B',
    ]);
    const firstTeam = screen.getAllByRole('table')[0];
    expect(within(firstTeam).getAllByRole('row').slice(1).map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
    expect(within(firstTeam).getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getAllByText('White').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Black').length).toBeGreaterThan(0);
    expect(within(firstTeam).getByText('Player 1')).toBeInTheDocument();
    expect(within(firstTeam).getByText('1')).toBeInTheDocument();
    expect(screen.getAllByLabelText('White bib color swatch')[0]).toHaveStyle({ backgroundColor: '#FFFFFF' });
  });

  it('filters team view by round, preserves All rounds, and carries the selected round to Position View', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });

    const teamRound = screen.getByLabelText('Team view round');
    expect(teamRound).toHaveValue('all');
    const roundNavigation = screen.getByRole('group', { name: 'Jump to a round' });
    expect(within(roundNavigation).getAllByRole('button')).toHaveLength(plan.rounds);
    const roundTwoHeading = document.getElementById('game-round-2')!;
    roundTwoHeading.scrollIntoView = vi.fn();
    fireEvent.click(within(roundNavigation).getByRole('button', { name: 'Round 2' }));
    expect(roundTwoHeading.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(teamRound).toHaveValue('all');
    expect(teamRound.closest('.full-game-round-filter')).not.toBeNull();
    expect(teamRound.closest('label')).toHaveClass('full-game-round-filter-label');
    expect(screen.getAllByRole('table')).toHaveLength(8);
    fireEvent.change(teamRound, { target: { value: '2' } });
    expect(screen.queryByRole('group', { name: 'Jump to a round' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(4);
    expect(screen.getAllByRole('table').every((table) => within(table).getByRole('caption').textContent?.startsWith('Round 2'))).toBe(true);

    fireEvent.change(teamRound, { target: { value: 'all' } });
    expect(screen.getAllByRole('table')).toHaveLength(8);
    expect(screen.getByRole('group', { name: 'Jump to a round' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Position View' }));
    expect(screen.getByLabelText('Round for position view')).toHaveValue('2');
    const tables = await screen.findAllByRole('table', { name: /Round 2 by position/ });
    expect(tables).toHaveLength(2);
    const table = tables[0];
    expect(within(table).getByRole('columnheader', { name: /Team A.*White/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Team B.*Black/ })).toBeInTheDocument();
    expect(within(table).getByText('Player 15')).toBeInTheDocument();
    expect(within(table).getByText('Number 15')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /Round 1 by position/ })).not.toBeInTheDocument();
  });

  it('does not offer edits for rounds in the frozen prefix', async () => {
    const frozenPlan = makePlan({ frozenThroughRound: 1 });
    renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(frozenPlan) }));
    await screen.findByRole('heading', { name: 'Full Game List' });

    expect(screen.getByText('This round is frozen and cannot be changed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit round 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit round 2' })).toBeInTheDocument();
  });

  it('keeps roster controls collapsed until needed so assignments lead the mobile view', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });

    const rosterChanges = screen.getByText('Roster changes');
    expect(rosterChanges.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Remove early leaver' })).not.toBeVisible();
    expect(screen.getByRole('heading', { name: 'Round 1' })).toBeInTheDocument();
    fireEvent.click(rosterChanges);
    expect(screen.getByRole('button', { name: 'Remove early leaver' })).toBeInTheDocument();
  });

  it('does not discard a local edit when revision history is unavailable', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });
    makeMove();

    expect(screen.getByRole('button', { name: 'Revision history' })).toBeDisabled();
    expect(screen.getByText(/save or cancel your round changes before viewing revision history/i)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).getByText('Player 3')).toBeInTheDocument();
  });

  it('opens revision history as a read-only view', async () => {
    const client = renderPage();
    await screen.findByRole('button', { name: 'Revision history' });
    fireEvent.click(screen.getByRole('button', { name: 'Revision history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View revision 1' }));

    expect(await screen.findByText('Viewing revision 1 — read-only')).toBeInTheDocument();
    expect(client.getPlanRevision).toHaveBeenCalledWith('event-1', 'plan-0');
    expect(screen.queryByRole('button', { name: 'Edit round 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to active revision' })).toBeInTheDocument();
  });

  it('shows a dash for a resting player without a number in revision history', async () => {
    const historical = makePlan({ id: 'plan-0', revision: 1, sourcePlanId: null });
    historical.players = [...historical.players, {
      registrationId: 'unnumbered', playerName: 'Unnumbered Player', bibNumber: null, rank1Position: 'GS',
      rank2Position: null, rank3Position: null, optInExtraPositions: true, active: true,
    }];
    renderPage(makeClient({ getPlanRevision: vi.fn().mockResolvedValue(historical) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revision history' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View revision 1' }));
    await screen.findByText('Viewing revision 1 — read-only');

    const resting = within(screen.getByRole('region', { name: 'Resting players' }));
    expect(resting.getByText('Unnumbered Player').closest('li')).toHaveTextContent('Unnumbered Player Number —');
    expect(resting.queryByText('Number 0')).not.toBeInTheDocument();
  });

  it('links an empty event to Plan Rounds', async () => {
    renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(null), getPlanRevisions: vi.fn().mockResolvedValue([]) }));
    expect(await screen.findByText('No published game plan yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Plan Rounds' })).toHaveAttribute('href', '/admin/events/event-1/plan');
  });

  it('lets an Admin mark an early leaver and request a reviewed suffix draft', async () => {
    const currentPlan = makePlan({ frozenThroughRound: 1, revision: 2, sourcePlanId: 'plan-0' });
    const client = renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(currentPlan) }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));
    expect(screen.getByLabelText('Remove future assignments from round')).toHaveValue('2');
    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 2 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild fixtures from round' }));

    await waitFor(() => expect(client.regeneratePlan).toHaveBeenCalledWith('event-1', 2, currentPlan.id, ['player-0']));
    expect(await screen.findByText('Draft revision 3 is ready for review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review draft in Plan Rounds' })).toHaveAttribute('href', '/admin/events/event-1/plan');
    expect(screen.getByText('Active revision 2')).toBeInTheDocument();
  });

  it('substitutes a resting arrival throughout the suffix and requires warning confirmation', async () => {
    const currentPlan = makePlan({ frozenThroughRound: 1, revision: 2, sourcePlanId: 'plan-0' });
    const lateArrival: GamePlayerDTO = {
      registrationId: 'late-player', playerName: 'Late Arrival', bibNumber: 99, rank1Position: 'GS',
      rank2Position: null, rank3Position: null, optInExtraPositions: true,
    };
    const client = renderPage(makeClient({
      getPublishedPlan: vi.fn().mockResolvedValue(currentPlan),
      getGameRoster: vi.fn().mockResolvedValue([...roster, lateArrival]),
      saveManualSuffix: vi.fn()
        .mockResolvedValueOnce({ ok: false, reason: 'warnings_required', warnings: [{ code: 'position_preference_warning', message: 'Review the suffix positions.' }] })
        .mockResolvedValueOnce({ ok: true, plan }),
    }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));
    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 2 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Manual replacements' }));
    fireEvent.change(screen.getByLabelText('Replacement for round 2, court 2, Team A, GS'), { target: { value: 'late-player' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save manual suffix' }));

    expect(await screen.findByText('Review the suffix positions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save suffix anyway' })).toBeInTheDocument();
    const firstInput = client.saveManualSuffix.mock.calls[0][1] as { sourcePlanId: string; fromRound: number; removedRegistrationIds: string[]; overrideWarnings: boolean; slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }> };
    expect(firstInput).toMatchObject({ sourcePlanId: 'plan-1', fromRound: 2, removedRegistrationIds: ['player-0'], overrideWarnings: false });
    expect(firstInput.slots).toHaveLength(28);
    expect(firstInput.slots.some((slot) => slot.round === 2 && slot.registrationId === 'player-0')).toBe(false);
    expect(firstInput.slots).toContainEqual(expect.objectContaining({ round: 2, registrationId: 'late-player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save suffix anyway' }));
    await waitFor(() => expect(client.saveManualSuffix).toHaveBeenCalledTimes(2));
    expect((client.saveManualSuffix.mock.calls[1][1] as { overrideWarnings: boolean }).overrideWarnings).toBe(true);
  });

  it('keeps substitutions local until save and Cancel restores the active schedule', async () => {
    const lateArrival: GamePlayerDTO = {
      registrationId: 'late-player', playerName: 'Late Arrival', bibNumber: 99, rank1Position: 'GS',
      rank2Position: null, rank3Position: null, optInExtraPositions: true,
    };
    const client = renderPage(makeClient({ getGameRoster: vi.fn().mockResolvedValue([...roster, lateArrival]) }));
    await screen.findByRole('heading', { name: 'Full Game List' });
    makeMove('late-player', '1:1:GS:0');

    expect(screen.getByText('Late Arrival')).toBeInTheDocument();
    expect(screen.getByText('Resting players')).toBeInTheDocument();
    expect(client.saveManualRound).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).queryByText('Late Arrival')).not.toBeInTheDocument();
    expect(screen.getByText('Late Arrival')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).getByText('Player 1')).toBeInTheDocument();
    expect(client.saveManualRound).not.toHaveBeenCalled();
  });

  it('swaps assigned players and saves only the selected round with the source revision', async () => {
    const client = renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });
    makeMove();
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).getByText('Player 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save round 1' }));

    await waitFor(() => expect(client.saveManualRound).toHaveBeenCalledTimes(1));
    const [, round, input] = client.saveManualRound.mock.calls[0] as [string, number, { sourcePlanId: string; overrideWarnings: boolean; slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }> }];
    expect(round).toBe(1);
    expect(input.sourcePlanId).toBe('plan-1');
    expect(input.overrideWarnings).toBe(false);
    expect(input.slots).toHaveLength(28);
    expect(input.slots).toContainEqual(expect.objectContaining({ round: 1, court: 1, position: 'GS', team: 0, registrationId: 'player-2' }));
    expect(input.slots.every((slot) => slot.round === 1)).toBe(true);
  });

  it('supports pointer drag and drop to swap assigned players and keeps the menu fallback', async () => {
    const client = renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit round 1' }));
    const table = screen.getByRole('table', { name: 'Round 1, Court 1, Team A' });
    const source = within(table).getByRole('button', { name: 'Move Player 1, Number 1' });
    const destination = within(table).getByRole('row', { name: /GA Player 3/ });
    const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => destination) });
    try {
      fireEvent.pointerDown(source, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(source, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
      fireEvent.pointerUp(source, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
    } finally {
      if (original) Object.defineProperty(document, 'elementFromPoint', original);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }

    expect(within(table).getByRole('row', { name: /GS Player 3/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /GA Player 1/ })).toBeInTheDocument();
    expect(screen.getByText('Use player and destination menus instead')).toBeInTheDocument();
    expect(client.saveManualRound).not.toHaveBeenCalled();
  });

  it('supports dropping an assigned player onto a resting player to substitute them', async () => {
    const lateArrival: GamePlayerDTO = {
      registrationId: 'late-player', playerName: 'Late Arrival', bibNumber: 99, rank1Position: 'GS',
      rank2Position: null, rank3Position: null, optInExtraPositions: true,
    };
    renderPage(makeClient({ getGameRoster: vi.fn().mockResolvedValue([...roster, lateArrival]) }));
    await screen.findByRole('heading', { name: 'Full Game List' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit round 1' }));
    const source = screen.getByRole('button', { name: 'Move Player 1, Number 1' });
    const restingPlayer = screen.getByRole('button', { name: 'Move Late Arrival, Number 99' });
    const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => restingPlayer) });
    try {
      fireEvent.pointerDown(source, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(source, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
      fireEvent.pointerUp(source, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 });
    } finally {
      if (original) Object.defineProperty(document, 'elementFromPoint', original);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }

    const teamA = screen.getByRole('table', { name: 'Round 1, Court 1, Team A' });
    expect(within(teamA).getByText('Late Arrival')).toBeInTheDocument();
    expect(within(teamA).queryByText('Player 1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resting players' })).getByText('Player 1')).toBeInTheDocument();
  });

  it('keeps hard validation errors blocking and retains the local edit for correction', async () => {
    renderPage(makeClient({
      saveManualRound: vi.fn().mockResolvedValue({ ok: false, reason: 'invalid_plan', errors: [{ code: 'no_solution', message: 'Every court position needs a player.' }] }),
    }));
    await screen.findByRole('heading', { name: 'Full Game List' });
    makeMove();
    fireEvent.click(screen.getByRole('button', { name: 'Save round 1' }));

    expect(await screen.findByText('Every court position needs a player.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save anyway' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel changes' })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).getByText('Player 3')).toBeInTheDocument();
  });

  it('requires a separate Save anyway action for soft warnings', async () => {
    const client = renderPage(makeClient({
      saveManualRound: vi.fn()
        .mockResolvedValueOnce({ ok: false, reason: 'warnings_required', warnings: [{ code: 'position_preference_warning', message: 'Check the position preference.' }] })
        .mockResolvedValueOnce({ ok: true, plan }),
    }));
    await screen.findByRole('heading', { name: 'Full Game List' });
    makeMove();
    fireEvent.click(screen.getByRole('button', { name: 'Save round 1' }));

    expect(await screen.findByText('Check the position preference.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save anyway' })).toBeInTheDocument();
    const firstInput = client.saveManualRound.mock.calls[0][2] as { overrideWarnings: boolean };
    expect(firstInput.overrideWarnings).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(client.saveManualRound).toHaveBeenCalledTimes(2));
    expect((client.saveManualRound.mock.calls[1][2] as { overrideWarnings: boolean }).overrideWarnings).toBe(true);
  });

  it('preserves local edits on stale revision and requires explicit refresh', async () => {
    const newer = makePlan({ id: 'plan-2', revision: 3, sourcePlanId: 'plan-1' });
    renderPage(makeClient({
      getPublishedPlan: vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(newer),
      saveManualRound: vi.fn().mockRejectedValue(new ApiError(409, 'stale_plan')),
    }));
    await screen.findByRole('heading', { name: 'Full Game List' });
    makeMove();
    fireEvent.click(screen.getByRole('button', { name: 'Save round 1' }));

    expect(await screen.findByText(/another Admin published a newer revision/i)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Round 1, Court 1, Team A' })).getByText('Player 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Player to move')).toBeDisabled();
    expect(screen.getByLabelText('Destination slot')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/local changes are not saved/i);
    expect(screen.getByRole('button', { name: 'Edit round 1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard local changes and refresh' }));
    expect(await screen.findByText('Active revision 3')).toBeInTheDocument();
    expect(screen.queryByText(/another Admin published a newer revision/i)).not.toBeInTheDocument();
  });

  it('offers an automatic suffix rebuild for selected early leavers and leaves the active plan unchanged', async () => {
    const currentPlan = makePlan({ frozenThroughRound: 1, revision: 2, sourcePlanId: 'plan-0' });
    const client = renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(currentPlan) }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));    expect(screen.getByLabelText('Remove future assignments from round')).toHaveValue('2');
    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 2 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild fixtures from round' }));

    await waitFor(() => expect(client.regeneratePlan).toHaveBeenCalledWith('event-1', 2, currentPlan.id, ['player-0']));
    expect(await screen.findByText('Draft revision 3 is ready for review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review draft in Plan Rounds' })).toHaveAttribute('href', '/admin/events/event-1/plan');
    expect(screen.getByText('Active revision 2')).toBeInTheDocument();
  });

  it('requires explicit refresh when another Admin changes the early-leaver source revision', async () => {
    const client = renderPage(makeClient({ regeneratePlan: vi.fn().mockRejectedValue(new ApiError(409, 'stale_plan')) }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));
    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 1 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild fixtures from round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/newer revision/i);
    expect(client.regeneratePlan).toHaveBeenCalledWith('event-1', 1, plan.id, ['player-0']);
    expect(client.regeneratePlan).toHaveBeenCalledTimes(1);
    expect(client.getPublishedPlan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Rebuild fixtures from round' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard local changes and refresh' })).toBeInTheDocument();
  });

  it('recognizes the API stale-source gap without clearing early-leaver selections or the active plan', async () => {
    const newer = makePlan({ id: 'plan-2', revision: 3 });
    const message = 'The source plan is not the active published revision.';
    const client = renderPage(makeClient({
      getPublishedPlan: vi.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce(newer),
      regeneratePlan: vi.fn().mockResolvedValue({ ok: false, gaps: [{ code: 'no_solution', message }] }),
    }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));
    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 1 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild fixtures from round' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('Active revision 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Player 1 from round 1 onward')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Rebuild fixtures from round' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Manual replacements' })).toBeDisabled();
    expect(client.getPublishedPlan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild fixtures from round' }));
    expect(client.regeneratePlan).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Discard local changes and refresh' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Remove future assignments from round'), { target: { value: '2' } });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Discard local changes and refresh' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revision history' }));
    fireEvent.click(screen.getByRole('button', { name: 'View revision 1' }));
    expect(screen.getByRole('button', { name: 'Discard local changes and refresh' })).toBeDisabled();
    await screen.findByText('Viewing revision 1 — read-only');
    expect(screen.getByRole('button', { name: 'Discard local changes and refresh' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Return to active revision' }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);

    fireEvent.click(screen.getByRole('button', { name: 'Discard local changes and refresh' }));
    expect(await screen.findByText('Active revision 3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps ordinary rebuild gaps retryable and preserves the early-leaver selection', async () => {
    renderPage(makeClient({ regeneratePlan: vi.fn().mockResolvedValue({
      ok: false, gaps: [{ code: 'no_solution', message: 'No complete suffix could be found.' }],
    }) }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));
    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 1 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild fixtures from round' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No complete suffix could be found.');
    expect(screen.getByLabelText('Remove Player 1 from round 1 onward')).toBeChecked();
    expect(screen.getByText('Active revision 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rebuild fixtures from round' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Discard local changes and refresh' })).not.toBeInTheDocument();
  });

  it('explains when a removed future slot has no eligible replacement', async () => {
    const currentPlan = makePlan({ frozenThroughRound: 1, revision: 2, sourcePlanId: 'plan-0' });
    renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(currentPlan) }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 2 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Manual replacements' }));

    expect(screen.getByText('No paid and checked-in player is available for round 2.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save manual suffix' })).toBeDisabled();
  });

  it('saves a complete manually replaced suffix and requires warning confirmation', async () => {
    const currentPlan = makePlan({ frozenThroughRound: 1, revision: 2, sourcePlanId: 'plan-0' });
    const lateArrival: GamePlayerDTO = {
      registrationId: 'late-player', playerName: 'Late Arrival', bibNumber: 99, rank1Position: 'GS',
      rank2Position: null, rank3Position: null, optInExtraPositions: true,
    };
    const client = renderPage(makeClient({
      getPublishedPlan: vi.fn().mockResolvedValue(currentPlan),
      getGameRoster: vi.fn().mockResolvedValue([...roster, lateArrival]),
      saveManualSuffix: vi.fn()
        .mockResolvedValueOnce({ ok: false, reason: 'warnings_required', warnings: [{ code: 'position_preference_warning', message: 'Review the suffix positions.' }] })
        .mockResolvedValueOnce({ ok: true, plan }),
    }));
    await screen.findByText('Active revision 2');
    openRosterChanges();
    fireEvent.click(screen.getByRole('button', { name: 'Remove early leaver' }));    fireEvent.click(screen.getByLabelText('Remove Player 1 from round 2 onward'));
    fireEvent.click(screen.getByRole('button', { name: 'Manual replacements' }));
    fireEvent.change(screen.getByLabelText('Replacement for round 2, court 2, Team A, GS'), { target: { value: 'late-player' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save manual suffix' }));

    expect(await screen.findByText('Review the suffix positions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save suffix anyway' })).toBeInTheDocument();
    const firstInput = client.saveManualSuffix.mock.calls[0][1] as { sourcePlanId: string; fromRound: number; removedRegistrationIds: string[]; overrideWarnings: boolean; slots: Array<{ round: number; registrationId: string }> };
    expect(firstInput).toMatchObject({ sourcePlanId: 'plan-1', fromRound: 2, removedRegistrationIds: ['player-0'], overrideWarnings: false });
    expect(firstInput.slots).toHaveLength(28);
    expect(firstInput.slots.some((slot) => slot.round === 2 && slot.registrationId === 'player-0')).toBe(false);
    expect(firstInput.slots).toContainEqual(expect.objectContaining({ round: 2, registrationId: 'late-player' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save suffix anyway' }));
    await waitFor(() => expect(client.saveManualSuffix).toHaveBeenCalledTimes(2));
    expect((client.saveManualSuffix.mock.calls[1][1] as { overrideWarnings: boolean }).overrideWarnings).toBe(true);
  });

  it('shows hand-checked game counts, ranked positions, other positions and resting/late players', async () => {
    renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(reportPlan), getGameRoster: vi.fn().mockResolvedValue(reportRoster) }));
    await screen.findByText('Active revision 2');
    fireEvent.click(screen.getByRole('button', { name: 'Player Statistics' }));

    const table = await screen.findByRole('table', { name: 'Player Statistics' });
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(name) });
    const values = (name: string) => within(row(name)).getAllByRole('cell').map((cell) => cell.textContent);
    expect(within(table).getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByText('Scroll horizontally to view all columns.')).toBeInTheDocument();
    expect(values('Player One')).toEqual(['1', '2', '2', '0', '0', '0', '10', '4']);
    expect(values('Player Two')).toEqual(['2', '2', '1', '1', '0', '0', '11', '3']);
    expect(values('Position Mismatch')).toEqual(['3', '2', '0', '0', '0', '2', '10', '4']);
    expect(values('Early Leaver')).toEqual(['4', '1', '1', '0', '0', '0', '7', '0']);
    expect(values('Resting Player')).toEqual(['16', '0', '0', '0', '0', '0', '0', '0']);
    expect(values('Late Arrival')).toEqual(['99', '0', '0', '0', '0', '0', '0', '0']);
    expect(within(table).getByRole('columnheader', { name: 'Unique opponents' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Repeat meetings' })).toBeInTheDocument();
    expect(screen.getByText(/unique opponents counts distinct opposing players/i)).toBeInTheDocument();
    expect(screen.queryByText(/anne@example.com|payment|\$35\.00/i)).not.toBeInTheDocument();
  });

  it('shows each player Number and per-round court, position, color, or Not playing', async () => {
    renderPage(makeClient({ getPublishedPlan: vi.fn().mockResolvedValue(reportPlan), getGameRoster: vi.fn().mockResolvedValue(reportRoster) }));
    await screen.findByText('Active revision 2');
    fireEvent.click(screen.getByRole('button', { name: 'Player Reference' }));

    const table = await screen.findByRole('table', { name: 'Player Reference' });
    expect(within(table).getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByText('Scroll horizontally to view all rounds.')).toBeInTheDocument();
    const cells = (name: string) => within(within(table).getByRole('row', { name: new RegExp(name) })).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells('Player One')).toEqual(['1', 'Court 1, GS, Team A — White', 'Court 1, GS, Team A — White']);
    expect(cells('Player Two')).toEqual(['2', 'Court 1, GA, Team A — White', 'Court 1, GS, Team B — Black']);
    expect(cells('Early Leaver')).toEqual(['4', 'Court 1, C, Team A — White', 'Not playing']);
    expect(cells('Resting Player')).toEqual(['16', 'Not playing', 'Not playing']);
    expect(cells('Late Arrival')).toEqual(['99', 'Not playing', 'Not playing']);
    expect(screen.queryByText(/anne@example.com|payment|\$35\.00/i)).not.toBeInTheDocument();
  });

  it('keeps team and position round controls available at a 390px viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderPage();
    await screen.findByRole('heading', { name: 'Full Game List' });
    expect(screen.getByRole('navigation', { name: 'Game views' })).toBeVisible();
    expect(screen.queryByLabelText('Game view')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Full Game List|Position View|Player Statistics|Player Reference/ })).toHaveLength(4);
    expect(screen.getByLabelText('Team view round')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit round 1' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Position View' }));
    expect(screen.getByLabelText('Round for position view')).toBeVisible();
    expect(screen.getByLabelText('Round for position view').closest('.full-game-round-filter')).not.toBeNull();
  });
});
