import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { melbourneDateKey } from '@netball-trials/types';
import { EventOperationsPage } from './EventOperationsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const savedEvent = {
  id: 'e1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
  gameStartTime: '09:00', registrationFeeCents: 3500, courts: 1,
  rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
  minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'DRAFT',
};

function operationsClient(overrides: Record<string, unknown> = {}) {
  return {
    getEvent: vi.fn().mockResolvedValue(savedEvent),
    checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt: null }),
    listBibColors: vi.fn().mockResolvedValue([]),
    getCourtColors: vi.fn().mockResolvedValue([]),
    setCourtColors: vi.fn(),
    openEvent: vi.fn().mockResolvedValue({ ...savedEvent, status: 'OPEN' }),
    closeEvent: vi.fn().mockResolvedValue({ ...savedEvent, status: 'CLOSED' }),
    setCheckInPin: vi.fn().mockResolvedValue(undefined),
    clearCheckInPin: vi.fn().mockResolvedValue(undefined),
    closeCheckIn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderOperations(client: Record<string, unknown>) {
  return render(<MemoryRouter><EventOperationsPage client={client as any} eventId="e1" /></MemoryRouter>);
}

describe('EventOperationsPage', () => {
  it('loads event identity and the existing operational controls', async () => {
    const client = operationsClient();
    renderOperations(client);

    expect(await screen.findByRole('heading', { name: 'Event operations' })).toBeInTheDocument();
    expect(await screen.findByText('15/U Ladies · 12 September 2027')).toBeInTheDocument();
    expect(await screen.findByText(/status: draft/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/set or rotate check-in pin/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team colors' })).toBeInTheDocument();
    expect(client.getEvent).toHaveBeenCalledWith('e1');
    expect(client.getCourtColors).toHaveBeenCalledWith('e1');
  });

  it('keeps lifecycle and check-in PIN actions available', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const client = operationsClient();
    renderOperations(client);

    expect(await screen.findByText(/status: draft/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Admin check-in' })).toHaveAttribute('href', '/admin/events/e1/check-in');
    fireEvent.click(screen.getByRole('button', { name: /open registration/i }));
    await waitFor(() => expect(client.openEvent).toHaveBeenCalledWith('e1'));
    expect(await screen.findByText('Registration is open.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/check-in pin/i), { target: { value: '482193' } });
    fireEvent.click(screen.getByRole('button', { name: /set or rotate pin/i }));
    await waitFor(() => expect(client.setCheckInPin).toHaveBeenCalledWith('e1', '482193'));
    const closeCheckIn = screen.getByRole('button', { name: /close check-in/i });
    const checkInAction = closeCheckIn.parentElement!;
    fireEvent.click(closeCheckIn);
    await waitFor(() => expect(client.closeCheckIn).toHaveBeenCalledWith('e1'));
    expect(await within(checkInAction).findByRole('status')).toHaveTextContent('Volunteer check-in is closed.');
    expect(within(checkInAction).queryByRole('button', { name: 'Close check-in' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close event/i }));
    await waitFor(() => expect(client.closeEvent).toHaveBeenCalledWith('e1'));
    expect(await screen.findByText('Registration is closed.')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('shows invalid PIN feedback beside the field and clears it on edit', async () => {
    const client = operationsClient();
    renderOperations(client);
    const pin = await screen.findByLabelText(/set or rotate check-in pin/i);
    const pinField = pin.closest('p')!;

    expect(pin).toHaveAttribute('inputmode', 'numeric');
    expect(pin).toHaveAttribute('minlength', '6');
    expect(pin).toHaveAttribute('maxlength', '8');
    expect(pin).toHaveAttribute('pattern', '[0-9]{6,8}');
    expect(pin).toHaveAccessibleDescription('Use 6 to 8 digits.');

    fireEvent.change(pin, { target: { value: '4821' } });
    fireEvent.click(screen.getByRole('button', { name: /set or rotate pin/i }));
    const alert = await within(pinField).findByRole('alert');
    expect(alert).toHaveTextContent('PIN must contain 6 to 8 digits.');
    expect(pin).toHaveAttribute('aria-invalid', 'true');
    expect(pin).toHaveAttribute('aria-describedby', 'checkInPin-hint checkInPin-error');
    expect(client.setCheckInPin).not.toHaveBeenCalled();

    fireEvent.change(pin, { target: { value: '482193' } });
    expect(within(pinField).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps PIN save errors beside the PIN field', async () => {
    const client = operationsClient({ setCheckInPin: vi.fn().mockRejectedValue(new Error('offline')) });
    renderOperations(client);
    const pin = await screen.findByLabelText(/set or rotate check-in pin/i);
    const pinField = pin.closest('p')!;
    fireEvent.change(pin, { target: { value: '482193' } });
    fireEvent.click(screen.getByRole('button', { name: /set or rotate pin/i }));

    expect(await within(pinField).findByRole('alert')).toHaveTextContent(/could not save the pin/i);
  });

  it('shows PIN save confirmation beside the PIN controls', async () => {
    const client = operationsClient();
    renderOperations(client);
    const pin = await screen.findByLabelText(/set or rotate check-in pin/i);
    const pinField = pin.closest('p')!;
    fireEvent.change(pin, { target: { value: '482193' } });
    fireEvent.click(screen.getByRole('button', { name: /set or rotate pin/i }));

    expect(await within(pinField).findByRole('status')).toHaveTextContent(/check-in pin saved/i);
  });

  it('explains event and check-in closure consequences beside secondary actions', async () => {
    const today = new Date(`${melbourneDateKey(new Date())}T00:00:00.000Z`).toISOString();
    const client = operationsClient({
      getEvent: vi.fn().mockResolvedValue({ ...savedEvent, status: 'OPEN', eventDate: today }),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: true, checkInClosedAt: null }),
    });
    renderOperations(client);

    const closeEvent = await screen.findByRole('button', { name: 'Close event' });
    const closeCheckIn = screen.getByRole('button', { name: 'Close check-in' });
    expect(screen.getByRole('heading', { level: 3, name: 'Registration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Volunteer check-in' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: 'Team colors' })).toBeInTheDocument();
    const registrationWarning = screen.getByText(/closing registration prevents new families from registering\. this event cannot be reopened from event operations/i);
    const checkInWarning = screen.getByText(/closing check-in revokes active volunteer sessions\. this event.s check-in cannot be reopened/i);
    expect(closeEvent).toHaveClass('button-secondary');
    expect(closeCheckIn).toHaveClass('button-secondary');
    expect(closeEvent.compareDocumentPosition(registrationWarning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(closeCheckIn.compareDocumentPosition(checkInWarning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains PIN removal revocation and reconfiguration beside the action', async () => {
    const client = operationsClient({ checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: true, checkInClosedAt: null }) });
    renderOperations(client);

    const removePin = await screen.findByRole('button', { name: 'Remove PIN' });
    const pinWarning = screen.getByText(/removing the pin revokes current volunteer sessions\. you can set a new pin later/i);
    expect(removePin).toHaveClass('button-secondary');
    expect(removePin.compareDocumentPosition(pinWarning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps PIN removal success beside the Remove PIN action', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const client = operationsClient({ checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: true, checkInClosedAt: null }) });
    renderOperations(client);
    const removePin = await screen.findByRole('button', { name: 'Remove PIN' });
    const pinRemovalAction = removePin.parentElement!;
    fireEvent.click(removePin);

    expect(await within(pinRemovalAction).findByRole('status')).toHaveTextContent(/PIN removed\. Existing volunteer sessions have been revoked\./i);
    expect(within(pinRemovalAction).queryByRole('button', { name: 'Remove PIN' })).not.toBeInTheDocument();
    expect(client.clearCheckInPin).toHaveBeenCalledWith('e1');
  });

  it('keeps PIN removal errors beside the Remove PIN action', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const client = operationsClient({
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: true, checkInClosedAt: null }),
      clearCheckInPin: vi.fn().mockRejectedValue(new Error('offline')),
    });
    renderOperations(client);
    const removePin = await screen.findByRole('button', { name: 'Remove PIN' });
    const pinRemovalAction = removePin.parentElement!;
    fireEvent.click(removePin);

    expect(await within(pinRemovalAction).findByRole('alert')).toHaveTextContent(/could not remove the pin/i);
  });

  it('keeps check-in closure errors beside Close check-in and leaves retry available', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const client = operationsClient({
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt: null }),
      closeCheckIn: vi.fn().mockRejectedValue(new Error('offline')),
    });
    renderOperations(client);
    const closeCheckIn = await screen.findByRole('button', { name: 'Close check-in' });
    const checkInAction = closeCheckIn.parentElement!;
    fireEvent.click(closeCheckIn);

    expect(await within(checkInAction).findByRole('alert')).toHaveTextContent(/could not close check-in/i);
    expect(within(checkInAction).getByRole('button', { name: 'Close check-in' })).toBeInTheDocument();
  });

  it('keeps day-of actions available when check-in is open', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const today = new Date(`${melbourneDateKey(new Date())}T00:00:00.000Z`).toISOString();
    const client = operationsClient({
      getEvent: vi.fn().mockResolvedValue({ ...savedEvent, status: 'OPEN', eventDate: today }),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: true, checkInClosedAt: null }),
    });
    renderOperations(client);

    expect(await screen.findByRole('link', { name: 'Admin check-in' })).toHaveAttribute('href', '/admin/events/e1/check-in');
    expect(screen.getByRole('link', { name: 'Add day-of player' })).toHaveAttribute('href', '/admin/events/e1/day-of-registration');
    fireEvent.change(screen.getByLabelText(/check-in pin/i), { target: { value: '482193' } });
    fireEvent.click(screen.getByRole('button', { name: /set or rotate pin/i }));
    await waitFor(() => expect(client.setCheckInPin).toHaveBeenCalledWith('e1', '482193'));
    fireEvent.click(screen.getByRole('button', { name: /close check-in/i }));
    await waitFor(() => expect(client.closeCheckIn).toHaveBeenCalledWith('e1'));
  });

  it('places conditional check-in actions before PIN and court settings', async () => {
    const today = new Date(`${melbourneDateKey(new Date())}T00:00:00.000Z`).toISOString();
    const client = operationsClient({
      getEvent: vi.fn().mockResolvedValue({ ...savedEvent, status: 'OPEN', eventDate: today }),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: true, checkInClosedAt: null }),
    });
    renderOperations(client);

    const actions = await screen.findByRole('navigation', { name: 'Event actions' });
    const adminCheckIn = within(actions).getByRole('link', { name: 'Admin check-in' });
    const dayOfRegistration = within(actions).getByRole('link', { name: 'Add day-of player' });
    const pin = screen.getByLabelText(/set or rotate check-in pin/i);
    const teamColors = screen.getByRole('heading', { name: 'Team colors' });
    expect(adminCheckIn.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dayOfRegistration.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(adminCheckIn.compareDocumentPosition(teamColors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    const event = { ...savedEvent, eventDate: date.toISOString(), status };
    const client = operationsClient({
      getEvent: vi.fn().mockResolvedValue(event),
      checkInSettings: vi.fn().mockResolvedValue({ pinConfigured: false, checkInClosedAt }),
    });
    renderOperations(client);

    await screen.findByText('PIN: Not configured');
    if (visible) expect(screen.getByRole('link', { name: 'Add day-of player' })).toHaveAttribute('href', '/admin/events/e1/day-of-registration');
    else expect(screen.queryByRole('link', { name: 'Add day-of player' })).not.toBeInTheDocument();
  });

  it('loads saved court colors for each event court', async () => {
    const white = { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null };
    const black = { id: 'black', name: 'Black', hex: '#111111', archivedAt: null };
    const client = operationsClient({
      getEvent: vi.fn().mockResolvedValue({ ...savedEvent, courts: 2 }),
      listBibColors: vi.fn().mockResolvedValue([white, black]),
      getCourtColors: vi.fn().mockResolvedValue([
        { court: 1, teamAColor: white, teamBColor: black },
        { court: 2, teamAColor: null, teamBColor: null },
      ]),
    });
    renderOperations(client);

    expect(await screen.findByLabelText('Court 1 Team A color')).toHaveValue('white');
    expect(screen.getByLabelText('Court 2 Team B color')).toBeInTheDocument();
    expect(client.listBibColors).toHaveBeenCalledTimes(1);
  });

  it('shows a load error instead of rendering controls when the event is unavailable', async () => {
    const client = operationsClient({ getEvent: vi.fn().mockRejectedValue(new Error('offline')) });
    renderOperations(client);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load event operations/i);
    expect(screen.queryByRole('heading', { name: 'Event controls' })).not.toBeInTheDocument();
  });
});
