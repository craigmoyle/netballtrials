import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { melbourneDateKey } from '@netball-trials/types';
import { ApiError } from '../api/client';
import { EventFormPage } from './EventFormPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(client: Record<string, unknown>) {
  return render(<MemoryRouter><EventFormPage client={client as any} /></MemoryRouter>);
}

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

const savedEvent = {
  id: 'e1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
  firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
  rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
  minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
};

function editEventClient(overrides: Record<string, unknown> = {}) {
  return {
    getEvent: vi.fn().mockResolvedValue(savedEvent),
    checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt: null }),
    listBibColors: vi.fn().mockResolvedValue([]),
    getCourtColors: vi.fn().mockResolvedValue([]),
    setCourtColors: vi.fn(),
    updateEvent: vi.fn().mockResolvedValue(savedEvent),
    deleteEvent: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function renderEditRoute(client: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={['/admin/events/e1']}>
      <Routes>
        <Route path="/admin/events/:id" element={<EventFormPage client={client as any} />} />
        <Route path="/admin/events" element={<h1>Events list</h1>} />
      </Routes>
      <CurrentPath />
    </MemoryRouter>,
  );
}

describe('EventFormPage', () => {
  it('cancels unsaved changes and exposes a separate link back to the event list', async () => {
    const updateEvent = vi.fn();
    renderEditRoute(editEventClient({ updateEvent }));
    await screen.findByDisplayValue('15/U Ladies');
    expect(screen.getByRole('link', { name: 'Back to events' })).toHaveAttribute('href', '/admin/events');
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Unsaved event name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events');
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('deletes an event after confirmation and returns to the event list', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const deleteEvent = vi.fn().mockResolvedValue(null);
    renderEditRoute(editEventClient({ deleteEvent }));
    await screen.findByDisplayValue('15/U Ladies');

    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/15\/U Ladies.*no registrations/i));
    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith('e1'));
    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
  });

  it('stays on the event and explains when registration history blocks deletion', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const deleteEvent = vi.fn().mockRejectedValue(new ApiError(409, 'event_has_registrations'));
    renderEditRoute(editEventClient({ deleteEvent }));
    await screen.findByDisplayValue('15/U Ladies');

    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be deleted because registration records exist/i);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/e1');
  });

  it('does not call the delete endpoint when the confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    const deleteEvent = vi.fn();
    renderEditRoute(editEventClient({ deleteEvent }));
    await screen.findByDisplayValue('15/U Ladies');

    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/e1');
  });

  it('sets policy age defaults when the division is selected', () => {
    renderForm({ createEvent: vi.fn() });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: '15/U' } });
    expect(screen.getByLabelText(/minimum age/i)).toHaveValue(12);
    expect(screen.getByLabelText(/maximum age/i)).toHaveValue(15);
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'All Abilities' } });
    expect(screen.getByLabelText(/minimum age/i)).toHaveValue(10);
  });

  it.each([
    ['OPEN', 0, null, true],
    ['CLOSED', 0, null, true],
    ['DRAFT', 0, null, false],
    ['OPEN', -1, null, false],
    ['CLOSED', 0, '2026-09-11T14:00:00.000Z', false],
  ])('shows Add day-of player only for an event today with check-in open (%s, %i)', async (status, dayOffset, checkInClosedAt, visible) => {
    const date = new Date(`${melbourneDateKey(new Date())}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    const event = {
      id: 'e1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: date.toISOString(), venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
      rank1Min: 0, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status,
    };
    const client = {
      getEvent: vi.fn().mockResolvedValue(event),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt }),
      listBibColors: vi.fn().mockResolvedValue([]),
      getCourtColors: vi.fn().mockResolvedValue([]),
      setCourtColors: vi.fn(),
    };
    render(<MemoryRouter initialEntries={['/admin/events/e1']}><Routes><Route path="/admin/events/:id" element={<EventFormPage client={client as any} />} /></Routes></MemoryRouter>);

    await screen.findByText('PIN: Not configured');
    if (visible) expect(screen.getByRole('link', { name: 'Add day-of player' })).toHaveAttribute('href', '/admin/events/e1/day-of-registration');
    else expect(screen.queryByRole('link', { name: 'Add day-of player' })).not.toBeInTheDocument();
  });

  it('loads saved Team A/B colors for the event courts', async () => {
    const event = {
      id: 'e1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2026-10-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 2,
      rank1Min: 0, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
    };
    const white = { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null };
    const black = { id: 'black', name: 'Black', hex: '#111111', archivedAt: null };
    const client = {
      getEvent: vi.fn().mockResolvedValue(event),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt: null }),
      listBibColors: vi.fn().mockResolvedValue([white, black]),
      getCourtColors: vi.fn().mockResolvedValue([
        { court: 1, teamAColor: white, teamBColor: black },
        { court: 2, teamAColor: null, teamBColor: null },
      ]),
      setCourtColors: vi.fn(),
    };
    render(<MemoryRouter initialEntries={['/admin/events/e1']}><Routes><Route path="/admin/events/:id" element={<EventFormPage client={client as any} />} /></Routes></MemoryRouter>);

    expect(await screen.findByLabelText('Court 1 Team A color')).toHaveValue('white');
    expect(screen.getByLabelText('Court 2 Team B color')).toBeInTheDocument();
    expect(client.listBibColors).toHaveBeenCalledTimes(1);
    expect(client.getCourtColors).toHaveBeenCalledWith('e1');
  });

  it('connects event lifecycle, check-in controls and links to the other workflows', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const event = {
      id: 'e1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
      eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
      firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 1,
      rank1Min: 0, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
      minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'DRAFT',
    };
    const client = {
      getEvent: vi.fn().mockResolvedValue(event),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt: null }),
      listBibColors: vi.fn().mockResolvedValue([]),
      getCourtColors: vi.fn().mockResolvedValue([]),
      setCourtColors: vi.fn(),
      openEvent: vi.fn().mockResolvedValue({ ...event, status: 'OPEN' }),
      closeEvent: vi.fn().mockResolvedValue({ ...event, status: 'CLOSED' }),
      setCheckInPin: vi.fn().mockResolvedValue(undefined),
      clearCheckInPin: vi.fn().mockResolvedValue(undefined),
      closeCheckIn: vi.fn().mockResolvedValue(undefined),
    };
    render(<MemoryRouter initialEntries={['/admin/events/e1']}><Routes><Route path="/admin/events/:id" element={<EventFormPage client={client as any} />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/status: draft/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Admin check-in' })).toHaveAttribute('href', '/admin/events/e1/check-in');
    expect(screen.getByRole('link', { name: 'Full Game List' })).toHaveAttribute('href', '/admin/events/e1/games');
    for (const name of ['Roster and export', 'Review queue', 'Plan rounds', 'Full Game List', 'Messages', 'Print selector sheets', 'Member associations']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /open registration/i }));
    await waitFor(() => expect(client.openEvent).toHaveBeenCalledWith('e1'));
    fireEvent.change(screen.getByLabelText(/check-in pin/i), { target: { value: '4821' } });
    fireEvent.click(screen.getByRole('button', { name: /set or rotate pin/i }));
    await waitFor(() => expect(client.setCheckInPin).toHaveBeenCalledWith('e1', '4821'));
    expect(screen.getByLabelText(/check-in pin/i)).toHaveValue('4821');
    fireEvent.click(screen.getByRole('button', { name: /close check-in/i }));
    await waitFor(() => expect(client.closeCheckIn).toHaveBeenCalledWith('e1'));
    fireEvent.click(screen.getByRole('button', { name: /close event/i }));
    await waitFor(() => expect(client.closeEvent).toHaveBeenCalledWith('e1'));
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it('shows fees in dollars, submits cents, and focuses a server-error summary', async () => {
    const createEvent = vi.fn().mockRejectedValue(new ApiError(400, 'validation_failed', ['eventDate', 'registrationFeeCents']));
    renderForm({ createEvent });
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: '15/U Ladies' } });
    fireEvent.change(screen.getByLabelText('Registration fee (AUD)'), { target: { value: '35.00' } });
    fireEvent.click(screen.getByRole('button', { name: /save event/i }));
    const summary = await screen.findByRole('alert', { name: /check these event details/i });
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(screen.getByLabelText('Event date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Registration fee (AUD)')).toHaveAttribute('aria-invalid', 'true');
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ registrationFeeCents: 3500 }));
    expect(screen.getByLabelText('Event name')).toHaveValue('15/U Ladies');
  });
});
