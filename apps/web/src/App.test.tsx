import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { App } from './App';

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  logout: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  checkInSettings: vi.fn(),
  checkInSummary: vi.fn(),
  openCheckIn: vi.fn(),
  openAdminCheckIn: vi.fn(),
  listBibColors: vi.fn(),
  createBibColor: vi.fn(),
  updateBibColor: vi.fn(),
  archiveBibColor: vi.fn(),
  getCourtColors: vi.fn(),
  setCourtColors: vi.fn(),
  getPublishedPlan: vi.fn(),
  getGameRoster: vi.fn(),
  getPlanRevisions: vi.fn(),
  getPlanRevision: vi.fn(),
  saveManualRound: vi.fn(),
  dayOfRegistration: vi.fn(),
  getRoster: vi.fn(),
  downloadRoster: vi.fn(),
  getPublicEvent: vi.fn(),
  listPublicEvents: vi.fn(),
  listPublicAssociations: vi.fn(),
  getTicket: vi.fn(),
  getBlankSheetHtml: vi.fn(),
  ticketCalendarUrl: vi.fn((token: string) => `/api/public/ticket/${token}/calendar`),
}));

vi.mock('./api/client', () => ({ apiClient: () => apiMocks }));

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderApp(path: string) {
  const router = createMemoryRouter([
    { path: '*', element: <><App /><CurrentPath /></> },
  ], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.logout.mockResolvedValue(undefined);
  apiMocks.listPublicEvents.mockResolvedValue([]);
  apiMocks.listPublicAssociations.mockResolvedValue([]);
  apiMocks.checkInSettings.mockResolvedValue({ pinConfigured: false, checkInClosedAt: null });
  apiMocks.checkInSummary.mockResolvedValue({ eventId: 'check-in-event', eventName: 'E2E Check-in', registered: 14, checkedIn: 0, closed: false });
  apiMocks.openAdminCheckIn.mockResolvedValue({ eventName: 'E2E Check-in' });
  apiMocks.listBibColors.mockResolvedValue([]);
  apiMocks.getCourtColors.mockResolvedValue([]);
  apiMocks.setCourtColors.mockResolvedValue({});
  apiMocks.getPublishedPlan.mockResolvedValue(null);
  apiMocks.getGameRoster.mockResolvedValue([]);
  apiMocks.getPlanRevisions.mockResolvedValue([]);
  apiMocks.getPlanRevision.mockResolvedValue(null);
  apiMocks.getBlankSheetHtml.mockResolvedValue('<main class="blank-sheet"><section class="sheet">Round: ______</section></main>');
  apiMocks.saveManualRound.mockResolvedValue({ ok: true, plan: null });
});

describe('Public home page', () => {
  it('shows open and closed upcoming trials, fees and registration only for open trials', async () => {
    apiMocks.listPublicEvents.mockResolvedValue([
      {
        id: 'open-trial', name: '15/U State Titles Trial', division: '15/U', section: 'Ladies',
        eventDate: '2099-03-01T00:00:00.000Z', venue: 'SNC', startTime: '08:30', firstWhistle: '09:00',
        registrationFeeCents: 3500, currency: 'aud', status: 'OPEN',
      },
      {
        id: 'closed-trial', name: '17/U State Titles Trial', division: '17/U', section: 'Ladies',
        eventDate: '2099-04-01T00:00:00.000Z', venue: 'MENA', startTime: '09:00', firstWhistle: '09:30',
        registrationFeeCents: 4000, currency: 'aud', status: 'CLOSED',
      },
    ]);

    renderApp('/');

    const homeHeading = await screen.findByRole('heading', { name: 'Upcoming trials' });
    expect(homeHeading).toBeInTheDocument();
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('link', { name: 'Trials home' }));
    const accessNav = screen.getByRole('navigation', { name: 'Access options' });
    expect(within(accessNav).getByRole('link', { name: 'Chisholm Admin' })).toHaveAttribute('href', '/admin');
    expect(within(accessNav).getByRole('link', { name: 'Volunteer check-in' })).toHaveAttribute('href', '/check-in');
    expect(within(accessNav).getAllByRole('link')).toHaveLength(2);
    expect(await screen.findByRole('heading', { name: '15/U State Titles Trial' })).toBeInTheDocument();
    expect(screen.getByText(/35\.00/)).toBeInTheDocument();
    expect(screen.getByText('1 March 2099')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register for 15/U State Titles Trial' })).toHaveAttribute('href', '/register/open-trial');
    expect(screen.getByText('Registration closed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Register for 17/U State Titles Trial' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chisholm Netball home' })).toHaveAttribute('href', 'https://chisholmnetball.com/');
    expect(apiMocks.me).not.toHaveBeenCalled();
  });

  it('shows the no-trials message and club link when the public list is empty', async () => {
    renderApp('/');

    expect(await screen.findByText('No trials currently scheduled.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chisholm Netball home' })).toBeInTheDocument();
  });

  it('offers retry when the trial list fails to load', async () => {
    apiMocks.listPublicEvents.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    renderApp('/');

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No trials currently scheduled.')).toBeInTheDocument();
    expect(apiMocks.listPublicEvents).toHaveBeenCalledTimes(2);
  });
});

describe('App route boundaries', () => {
  it('takes a signed-in Admin from the public menu to the dashboard', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.listEvents.mockResolvedValue([]);
    renderApp('/');

    fireEvent.click(screen.getByRole('link', { name: 'Chisholm Admin' }));

    expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events');
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
  });

  it('sends a signed-out Admin menu click to email sign in', async () => {
    apiMocks.me.mockRejectedValue(new Error('unauthenticated'));
    renderApp('/');

    fireEvent.click(screen.getByRole('link', { name: 'Chisholm Admin' }));

    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/login');
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
  });

  it('loads public registration without checking admin authentication', async () => {
    apiMocks.getPublicEvent.mockResolvedValue({
      id: 'event-1', name: 'Trials', division: '15/U', section: 'Ladies', eventDate: '2026-09-12T00:00:00.000Z',
      venue: 'Chisholm', startTime: '08:30', firstWhistle: '09:00', competitionYear: 2027, registrationFeeCents: 0, currency: 'aud', policyUrl: null,
      minAge: 12, maxAge: 15, courts: 1, status: 'OPEN',
    });
    renderApp('/register/event-1');
    expect(await screen.findByRole('heading', { name: 'Trials' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Access options' })).toBeInTheDocument();
    expect(apiMocks.getPublicEvent).toHaveBeenCalledWith('event-1');
    expect(apiMocks.me).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Register for trials | Chisholm Netball Trials'));
  });

  it('loads a public ticket without checking admin authentication', async () => {
    apiMocks.getTicket.mockResolvedValue({ playerName: 'Ada Lovelace', qrCode: 'data:image/png;base64,YWJj', event: { name: 'Trials' } });
    renderApp('/ticket/opaque-token');
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(apiMocks.getTicket).toHaveBeenCalledWith('opaque-token');
    expect(apiMocks.me).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Your trial ticket | Chisholm Netball Trials'));
  });

  it('redirects a protected admin route after checking the admin session', async () => {
    apiMocks.me.mockRejectedValue(new Error('unauthenticated'));
    renderApp('/admin/events');
    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Access options' })).toBeInTheDocument();
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/login');
  });

  it('uses router navigation for internal admin links and sets a contextual title', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.listEvents.mockResolvedValue([]);
    renderApp('/admin/events');
    const newEvent = await screen.findByRole('link', { name: 'New event' });
    expect(screen.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Access options' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Events | Chisholm Netball Trials'));
    fireEvent.click(newEvent);
    expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Event workflows' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/new');
    await waitFor(() => expect(document.title).toBe('New event | Chisholm Netball Trials'));
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
  });

  it('allows a signed-in Admin to start event-scoped check-in without a PIN', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    renderApp('/admin/events/check-in-event/check-in');

    expect(await screen.findByRole('heading', { name: 'E2E Check-in' })).toBeInTheDocument();
    expect(apiMocks.openAdminCheckIn).toHaveBeenCalledWith('check-in-event');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/check-in/scan');
    expect(screen.getByRole('link', { name: 'Look up by name instead' })).toHaveAttribute('href', '/check-in/lookup');
    expect(screen.queryByLabelText('Event PIN')).not.toBeInTheDocument();
  });

  it('loads Full Game List through the protected Admin route with an empty-plan path to Plan Rounds', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.getEvent.mockResolvedValue({
      id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 2,
      rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
    });
    renderApp('/admin/events/event-1/games');

    expect(await screen.findByText('No published game plan yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Full Game List' })).toBeInTheDocument();
    const eventNav = screen.getByRole('navigation', { name: 'Event workflows' });
    const eventToolsToggle = within(eventNav).getByRole('button', { name: 'Event tools: Full Game List' });
    expect(eventToolsToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(eventToolsToggle);
    expect(eventToolsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(eventNav).getByRole('link', { name: 'Full Game List' })).toHaveAttribute('aria-current', 'page');
    expect(within(eventNav).getByRole('link', { name: 'Volunteer check-in' })).toHaveAttribute('href', '/check-in?eventId=event-1');
    expect(within(eventNav).getByRole('link', { name: 'Event settings' })).toHaveAttribute('href', '/admin/events/event-1');
    expect(within(eventNav).getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Open Plan Rounds' })).toHaveAttribute('href', '/admin/events/event-1/plan');
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
    expect(apiMocks.getPublishedPlan).toHaveBeenCalledWith('event-1');
    expect(apiMocks.getGameRoster).toHaveBeenCalledWith('event-1');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/event-1/games');
    await waitFor(() => expect(document.title).toBe('Full Game List | Chisholm Netball Trials'));
  });

  it('loads the standalone blank game sheet through the protected Admin route', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    renderApp('/admin/events/event-1/sheets/blank');

    expect(await screen.findByRole('heading', { name: 'Blank game sheet' })).toBeInTheDocument();
    expect(screen.getByText('Round: ______')).toBeInTheDocument();
    const eventNav = screen.getByRole('navigation', { name: 'Event workflows' });
    expect(within(eventNav).getByRole('link', { name: 'Print selector sheets' })).toHaveAttribute('aria-current', 'page');
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
    expect(apiMocks.getBlankSheetHtml).toHaveBeenCalledWith('event-1');
    expect(apiMocks.getPublishedPlan).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/event-1/sheets/blank');
    await waitFor(() => expect(document.title).toBe('Blank game sheet | Chisholm Netball Trials'));
  });

  it('keeps operational controls off settings and opens them from Event operations', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.getEvent.mockResolvedValue({
      id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
      rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
    });
    renderApp('/admin/events/event-1');
    await screen.findByLabelText('Event name');
    expect(screen.queryByRole('heading', { name: 'Event controls' })).not.toBeInTheDocument();

    const eventNav = screen.getByRole('navigation', { name: 'Event workflows' });
    fireEvent.click(within(eventNav).getByRole('link', { name: 'Event operations' }));

    expect(await screen.findByRole('heading', { name: 'Event operations' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Event controls' })).toBeInTheDocument();
    expect(screen.getByText('15/U Ladies · 12 September 2027')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Event workflows' })).getByRole('link', { name: 'Event operations' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the mobile workflow menu open when dirty navigation is canceled', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.getEvent.mockResolvedValue({
      id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
      rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
    });
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    renderApp('/admin/events/event-1');
    const eventNav = await screen.findByRole('navigation', { name: 'Event workflows' });
    const toggle = within(eventNav).getByRole('button', { name: 'Event tools: Event settings' });
    fireEvent.click(toggle);
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved venue' } });

    fireEvent.click(within(eventNav).getByRole('link', { name: 'Event operations' }));

    expect(confirm).toHaveBeenCalledWith('You have unsaved event changes. Leave without saving?');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/event-1');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved venue');

    confirm.mockReturnValue(true);
    fireEvent.click(within(eventNav).getByRole('link', { name: 'Event operations' }));
    expect(await screen.findByRole('heading', { name: 'Event operations' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('loads the Admin bib color catalog through the protected Admin route', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.listBibColors.mockResolvedValue([{ id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null }]);
    renderApp('/admin/bib-colors');

    expect(await screen.findByRole('heading', { name: 'Bib colors' })).toBeInTheDocument();
    expect(screen.getByText('White')).toBeInTheDocument();
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
    expect(apiMocks.listBibColors).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Bib colors' })).toHaveAttribute('href', '/admin/bib-colors');
  });

  it('loads the Admin-assisted day-of registration through the protected Admin route', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.getEvent.mockResolvedValue({
      id: 'event-1', name: '15/U Ladies', eventDate: '2026-09-12T00:00:00.000Z', venue: 'SNC',
      startTime: '08:30', firstWhistle: '09:00', competitionYear: 2027, registrationFeeCents: 3500,
      currency: 'aud', policyUrl: null, minAge: 12, maxAge: 15,
    });
    renderApp('/admin/events/event-1/day-of-registration');

    expect(await screen.findByRole('heading', { name: '15/U Ladies' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Event tools: Day-of registration' })).toHaveAttribute('aria-expanded', 'false');
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
    expect(apiMocks.getEvent).toHaveBeenCalledWith('event-1');
    expect(apiMocks.getPublicEvent).not.toHaveBeenCalled();
    expect(apiMocks.listPublicAssociations).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.title).toBe('Admin-assisted registration | Chisholm Netball Trials'));
  });

  it('keeps the home logo and check-in navigation without public sign-in links during a session', async () => {
    renderApp('/check-in/lookup');

    expect(await screen.findByRole('heading', { name: 'E2E Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
    const checkInNav = screen.getByRole('navigation', { name: 'Check-in' });
    expect(within(checkInNav).getByRole('link', { name: 'Scan' })).toHaveAttribute('href', '/check-in/scan');
    expect(within(checkInNav).getByRole('link', { name: 'Lookup' })).toHaveAttribute('href', '/check-in/lookup');
    expect(screen.queryByRole('navigation', { name: 'Access options' })).not.toBeInTheDocument();
    expect(apiMocks.me).not.toHaveBeenCalled();
  });

  it('navigates from events to the connected event roster without a document reload', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.listEvents.mockResolvedValue([{ id: 'event-1', name: '15/U Ladies', eventDate: '2027-09-12', courts: 1, status: 'OPEN' }]);
    apiMocks.getEvent.mockResolvedValue({
      id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
      rank1Min: 0, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, status: 'OPEN',
    });
    apiMocks.checkInSettings.mockResolvedValue({ pinConfigured: false, checkInClosedAt: null });
    apiMocks.getRoster.mockResolvedValue({ eventId: 'event-1', registrations: [], positionCounts: { rank1: {}, rank2: {}, rank3: {}, extraOptIn: 0 } });
    renderApp('/admin/events');
    fireEvent.click(await screen.findByRole('link', { name: '15/U Ladies' }));
    const eventNav = await screen.findByRole('navigation', { name: 'Event workflows' });
    expect(within(eventNav).getByRole('link', { name: 'Event settings' })).toHaveAttribute('aria-current', 'page');
    const confirmNavigation = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmNavigation);
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved venue' } });
    fireEvent.click(within(eventNav).getByRole('link', { name: 'Roster and export' }));
    expect(confirmNavigation).toHaveBeenCalledWith('You have unsaved event changes. Leave without saving?');
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved venue');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/event-1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(apiMocks.logout).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved venue');
    confirmNavigation.mockReturnValue(true);
    fireEvent.click(within(eventNav).getByRole('link', { name: 'Roster and export' }));
    expect(await screen.findByRole('heading', { name: /roster/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/event-1/roster');
    expect(within(screen.getByRole('navigation', { name: 'Event workflows' })).getByRole('link', { name: 'Roster and export' })).toHaveAttribute('aria-current', 'page');
  });

  it('confirms dirty event changes before signing out and prompts only once', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.getEvent.mockResolvedValue({
      id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
      rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
    });
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    renderApp('/admin/events/event-1');
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved venue' } });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(apiMocks.logout).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('loads the volunteer PIN screen without calling the admin session endpoint', async () => {
    renderApp('/check-in');
    expect(await screen.findByRole('heading', { name: 'Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Access options' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event PIN')).toHaveAttribute('type', 'password');
    expect(screen.getByText(/enter the event id and pin for your trial/i)).toBeInTheDocument();
    expect(screen.getByText(/ask your event coordinator/i)).toBeInTheDocument();
    expect(apiMocks.me).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Volunteer check-in | Chisholm Netball Trials'));
  });

  it('prefills the Event ID from an event-specific volunteer link', async () => {
    renderApp('/check-in?eventId=event-42');

    expect(await screen.findByRole('heading', { name: 'Check-in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Event ID')).toHaveValue('event-42');
    expect(screen.getByLabelText('Event PIN')).toHaveAttribute('type', 'password');
  });

  it('requires the Event ID before starting volunteer check-in', async () => {
    renderApp('/check-in');

    fireEvent.click(await screen.findByRole('button', { name: 'Start check-in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the Event ID.');
    expect(apiMocks.openCheckIn).not.toHaveBeenCalled();
  });

  it('requires the Event PIN when an event-specific link pre-fills the ID', async () => {
    renderApp('/check-in?eventId=event-42');

    fireEvent.click(await screen.findByRole('button', { name: 'Start check-in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the Event PIN.');
    expect(apiMocks.openCheckIn).not.toHaveBeenCalled();
  });
});
