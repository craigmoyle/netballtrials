import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from './App';

const apiMocks = vi.hoisted(() => ({
  me: vi.fn(),
  listEvents: vi.fn(),
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

  it('loads the volunteer PIN screen without calling the admin session endpoint', async () => {
    renderApp('/check-in');
    expect(await screen.findByRole('heading', { name: 'Check-in' })).toBeInTheDocument();
    expect(apiMocks.me).not.toHaveBeenCalled();
    await waitFor(() => expect(document.title).toBe('Volunteer check-in | Chisholm Netball Trials'));
  });
});
