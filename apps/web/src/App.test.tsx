import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from './App';

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  checkInSettings: vi.fn(),
  checkInSummary: vi.fn(),
  openAdminCheckIn: vi.fn(),
  getRoster: vi.fn(),
  downloadRoster: vi.fn(),
  getPublicEvent: vi.fn(),
  listPublicEvents: vi.fn(),
  listPublicAssociations: vi.fn(),
  getTicket: vi.fn(),
  ticketCalendarUrl: vi.fn((token: string) => `/api/public/ticket/${token}/calendar`),
}));

vi.mock('./api/client', () => ({ apiClient: () => apiMocks }));

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listPublicEvents.mockResolvedValue([]);
  apiMocks.listPublicAssociations.mockResolvedValue([]);
  apiMocks.checkInSummary.mockResolvedValue({ eventId: 'check-in-event', eventName: 'E2E Check-in', registered: 14, checkedIn: 0, closed: false });
  apiMocks.openAdminCheckIn.mockResolvedValue({ eventName: 'E2E Check-in' });
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
    const signInNav = screen.getByRole('navigation', { name: 'Sign in options' });
    expect(within(signInNav).getByRole('link', { name: 'Chisholm Admin' })).toHaveAttribute('href', '/admin');
    expect(within(signInNav).getByRole('link', { name: 'Committee member' })).toHaveAttribute('href', '/check-in');
    expect(within(signInNav).getByRole('link', { name: 'Volunteer' })).toHaveAttribute('href', '/check-in');
    expect(await screen.findByRole('heading', { name: '15/U State Titles Trial' })).toBeInTheDocument();
    expect(screen.getByText(/35\.00/)).toBeInTheDocument();
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
    expect(screen.getByRole('navigation', { name: 'Sign in options' })).toBeInTheDocument();
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
    expect(screen.getByRole('navigation', { name: 'Sign in options' })).toBeInTheDocument();
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
    expect(screen.queryByRole('navigation', { name: 'Sign in options' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Events | Chisholm Netball Trials'));
    fireEvent.click(newEvent);
    expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
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

  it('keeps the home logo and check-in navigation without public sign-in links during a session', async () => {
    renderApp('/check-in/lookup');

    expect(await screen.findByRole('heading', { name: 'E2E Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
    const checkInNav = screen.getByRole('navigation', { name: 'Check-in' });
    expect(within(checkInNav).getByRole('link', { name: 'Scan' })).toHaveAttribute('href', '/check-in/scan');
    expect(within(checkInNav).getByRole('link', { name: 'Lookup' })).toHaveAttribute('href', '/check-in/lookup');
    expect(screen.queryByRole('navigation', { name: 'Sign in options' })).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('link', { name: 'Roster and export' }));
    expect(await screen.findByRole('heading', { name: /roster/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/event-1/roster');
  });

  it('loads the volunteer PIN screen without calling the admin session endpoint', async () => {
    renderApp('/check-in');
    expect(await screen.findByRole('heading', { name: 'Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sign in options' })).toBeInTheDocument();
    expect(apiMocks.me).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Volunteer check-in | Chisholm Netball Trials'));
  });
});
