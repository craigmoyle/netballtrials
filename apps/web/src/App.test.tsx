import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from './App';

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  checkInSettings: vi.fn(),
  getRoster: vi.fn(),
  downloadRoster: vi.fn(),
  getPublicEvent: vi.fn(),
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
  apiMocks.listPublicAssociations.mockResolvedValue([]);
});

describe('App route boundaries', () => {
  it('loads public registration without checking admin authentication', async () => {
    apiMocks.getPublicEvent.mockResolvedValue({
      id: 'event-1', name: 'Trials', division: '15/U', section: 'Ladies', eventDate: '2026-09-12T00:00:00.000Z',
      venue: 'Chisholm', startTime: '08:30', firstWhistle: '09:00', competitionYear: 2027, registrationFeeCents: 0, currency: 'aud', policyUrl: null,
      minAge: 12, maxAge: 15, courts: 1, status: 'OPEN',
    });
    renderApp('/register/event-1');
    expect(await screen.findByRole('heading', { name: 'Trials' })).toBeInTheDocument();
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
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/login');
  });

  it('uses router navigation for internal admin links and sets a contextual title', async () => {
    apiMocks.me.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } });
    apiMocks.listEvents.mockResolvedValue([]);
    renderApp('/admin/events');
    const newEvent = await screen.findByRole('link', { name: 'New event' });
    await waitFor(() => expect(document.title).toBe('Events | Chisholm Netball Trials'));
    fireEvent.click(newEvent);
    expect(await screen.findByRole('heading', { name: 'New event' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/new');
    await waitFor(() => expect(document.title).toBe('New event | Chisholm Netball Trials'));
    expect(apiMocks.me).toHaveBeenCalledTimes(1);
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
    expect(apiMocks.me).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Volunteer check-in | Chisholm Netball Trials'));
  });
});
