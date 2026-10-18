import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { EventFormPage } from './EventFormPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(client: Record<string, unknown>) {
  const router = createMemoryRouter([
    { path: '/admin/events/new', element: <EventFormPage client={client as any} /> },
    { path: '/admin/events', element: <h1>Events list</h1> },
  ], { initialEntries: ['/admin/events/new'] });
  return render(<RouterProvider router={router} />);
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

function renderEditRoute(
  client: Record<string, unknown>,
  initialEntries = ['/admin/events/e1'],
  initialIndex = initialEntries.length - 1,
) {
  const router = createMemoryRouter([
    { path: '/admin/events/:id', element: <><EventFormPage client={client as any} /><CurrentPath /></> },
    { path: '/admin/events', element: <><h1>Events list</h1><CurrentPath /></> },
  ], { initialEntries, initialIndex });
  render(<RouterProvider router={router} />);
  return router;
}

describe('EventFormPage', () => {
  it('keeps existing-event fields unavailable until saved details load', async () => {
    let resolveEvent!: (event: typeof savedEvent) => void;
    const pendingEvent = new Promise<typeof savedEvent>((resolve) => { resolveEvent = resolve; });
    const client = editEventClient({ getEvent: vi.fn(() => pendingEvent) });
    renderEditRoute(client);

    expect(screen.getByText(/loading event details/i)).toHaveAttribute('role', 'status');
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();

    await act(async () => { resolveEvent(savedEvent); });

    expect(await screen.findByLabelText('Event name')).toHaveValue('15/U Ladies');
  });

  it('offers retry and keeps the form unavailable when event loading fails', async () => {
    const getEvent = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(savedEvent);
    renderEditRoute(editEventClient({ getEvent }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the event.');
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByLabelText('Event name')).toHaveValue('15/U Ladies');
    expect(getEvent).toHaveBeenCalledTimes(2);
  });

  it('shows event identity and grouped settings while keeping operations separate', async () => {
    renderEditRoute(editEventClient());

    expect(await screen.findByText('15/U Ladies · 12 September 2027')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Event details' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Trial format' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Selection settings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event controls' })).not.toBeInTheDocument();
    const venue = screen.getByLabelText('Venue');
    const deleteHeading = screen.getByRole('heading', { name: 'Delete event' });
    expect(venue.compareDocumentPosition(deleteHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prompts before the Cancel button discards unsaved changes', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const updateEvent = vi.fn();
    renderEditRoute(editEventClient({ updateEvent }));
    await screen.findByDisplayValue('15/U Ladies');
    expect(screen.getByRole('link', { name: 'Back to events' })).toHaveAttribute('href', '/admin/events');
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Unsaved event name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('You have unsaved event changes. Leave without saving?');
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('asks before a dirty edit leaves through a link and retains it when navigation is canceled', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    renderEditRoute(editEventClient());

    const venue = await screen.findByLabelText('Venue');
    fireEvent.change(venue, { target: { value: 'Updated venue' } });
    fireEvent.click(screen.getByRole('link', { name: 'Back to events' }));

    expect(confirm).toHaveBeenCalledWith('You have unsaved event changes. Leave without saving?');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/e1');
    expect(screen.getByLabelText('Venue')).toHaveValue('Updated venue');
  });

  it('blocks browser Back and retains edits when the user stays', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const router = renderEditRoute(editEventClient(), ['/admin/events', '/admin/events/e1'], 1);
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved before Back' } });

    await act(async () => { await router.navigate(-1); });

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('You have unsaved event changes. Leave without saving?'));
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/e1');
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved before Back');
  });

  it('follows browser Back and discards edits when the user confirms', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const router = renderEditRoute(editEventClient(), ['/admin/events', '/admin/events/e1'], 1);
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved before Back' } });

    await act(async () => { await router.navigate(-1); });

    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events');
  });

  it('blocks browser Forward and retains edits when the user stays', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const router = renderEditRoute(editEventClient(), ['/admin/events/e1?state=back', '/admin/events/e1?state=forward'], 0);
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved before Forward' } });

    await act(async () => { await router.navigate(1); });

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('You have unsaved event changes. Leave without saving?'));
    expect(router.state.location.search).toBe('?state=back');
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved before Forward');
  });

  it('follows browser Forward and discards edits when the user confirms', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const router = renderEditRoute(editEventClient(), ['/admin/events/e1?state=back', '/admin/events/e1?state=forward'], 0);
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved before Forward' } });

    await act(async () => { await router.navigate(1); });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toBe('?state=forward');
  });

  it('guards page unload after an event edit becomes dirty', async () => {
    renderEditRoute(editEventClient());
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Updated venue' } });

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);

    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it('returns to the event list after a successful dirty update without a second prompt', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const updateEvent = vi.fn().mockResolvedValue(savedEvent);
    renderEditRoute(editEventClient({ updateEvent }));
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Updated venue' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('preserves a dirty event edit and route when an update fails', async () => {
    const updateEvent = vi.fn().mockRejectedValue(new Error('offline'));
    renderEditRoute(editEventClient({ updateEvent }));
    const venue = await screen.findByLabelText('Venue');
    fireEvent.change(venue, { target: { value: 'Unsaved venue' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changes are still here/i);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/admin/events/e1');
    expect(screen.getByLabelText('Venue')).toHaveValue('Unsaved venue');
    expect(updateEvent).toHaveBeenCalledTimes(1);
  });

  it('returns to the event list after a successful create without a dirty prompt', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const createEvent = vi.fn().mockResolvedValue(savedEvent);
    renderForm({ createEvent });
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'New trials' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('deletes an event after confirmation and returns to the event list', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const deleteEvent = vi.fn().mockResolvedValue(null);
    renderEditRoute(editEventClient({ deleteEvent }));
    fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: 'Unsaved venue' } });

    fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/15\/U Ladies.*no registrations/i));
    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith('e1'));
    expect(await screen.findByRole('heading', { name: 'Events list' })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
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
