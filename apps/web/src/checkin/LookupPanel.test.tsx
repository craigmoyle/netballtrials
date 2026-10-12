import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CheckInLayout } from './CheckInLayout';
import { LookupPanel } from './LookupPanel';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('LookupPanel', () => {
  it('refreshes the volunteer count after manual check-in and authorized undo', async () => {
    const client = {
      checkInSummary: vi.fn()
        .mockResolvedValueOnce({ eventId: 'e1', eventName: 'Trials', registered: 1, checkedIn: 0, closed: false })
        .mockResolvedValueOnce({ eventId: 'e1', eventName: 'Trials', registered: 1, checkedIn: 1, closed: false })
        .mockResolvedValueOnce({ eventId: 'e1', eventName: 'Trials', registered: 1, checkedIn: 0, closed: false }),
      lookup: vi.fn().mockResolvedValue([{ id: 'r1', playerName: 'Ada Lovelace', bibNumber: null, checkedIn: false }]),
      manualCheckIn: vi.fn().mockResolvedValue({ result: 'checked_in', registrationId: 'r1', playerName: 'Ada Lovelace', bibNumber: 5, referToCommittee: true }),
      undoCheckIn: vi.fn().mockResolvedValue(undefined),
    };
    render(<MemoryRouter><CheckInLayout client={client as any} /><LookupPanel client={client as any} /></MemoryRouter>);
    expect(await screen.findByText('0 of 1 arrived')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/player name/i), { target: { value: 'Ada' } });
    fireEvent.click(await screen.findByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ada Lovelace, Number 5 — Refer to committee');
    expect(await screen.findByText('1 of 1 arrived')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /undo last check-in/i }));
    await waitFor(() => expect(client.undoCheckIn).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('0 of 1 arrived')).toBeInTheDocument();
  });

  it('cancels the pending lookup debounce when the panel unmounts', async () => {
    vi.useFakeTimers();
    const lookup = vi.fn().mockResolvedValue([]);
    const view = render(<MemoryRouter><LookupPanel client={{ lookup } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/player name/i), { target: { value: 'Ada' } });
    expect(lookup).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('announces manual check-in API errors and leaves the result retryable', async () => {
    const client = {
      checkInSummary: vi.fn().mockResolvedValue({ eventId: 'e1', eventName: 'Trials', registered: 1, checkedIn: 0, closed: false }),
      lookup: vi.fn().mockResolvedValue([{ id: 'r1', playerName: 'Ada Lovelace', bibNumber: null, checkedIn: false }]),
      manualCheckIn: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ result: 'checked_in', registrationId: 'r1', playerName: 'Ada Lovelace', bibNumber: 5, referToCommittee: false }),
    };
    render(<MemoryRouter><LookupPanel client={client as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/player name/i), { target: { value: 'Ada' } });
    fireEvent.click(await screen.findByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not check in/i);
    fireEvent.click(screen.getByRole('button', { name: /check in/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('Ada Lovelace, Number 5');
  });
});
