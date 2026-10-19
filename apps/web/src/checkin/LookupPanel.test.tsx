import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CheckInLayout } from './CheckInLayout';
import { LookupPanel } from './LookupPanel';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('LookupPanel', () => {
  it('announces searching and an empty result for a completed lookup', async () => {
    vi.useFakeTimers();
    let resolveLookup!: (rows: Array<{ id: string; playerName: string; bibNumber: number | null; checkedIn: boolean }>) => void;
    const lookup = vi.fn(() => new Promise((resolve) => { resolveLookup = resolve; }));
    render(<MemoryRouter><LookupPanel client={{ lookup } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/player name/i), { target: { value: 'Ada' } });

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByRole('status')).toHaveTextContent('Searching registrations...');
    await act(async () => { resolveLookup([]); await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('No players found matching that name.');
  });

  it('clears stale results while searching a new name', async () => {
    vi.useFakeTimers();
    const ada = { id: 'r1', playerName: 'Ada Lovelace', bibNumber: null, checkedIn: false };
    const grace = { id: 'r2', playerName: 'Grace Hopper', bibNumber: null, checkedIn: false };
    let resolveGrace!: (rows: typeof grace[]) => void;
    const lookup = vi.fn()
      .mockResolvedValueOnce([ada])
      .mockReturnValueOnce(new Promise((resolve) => { resolveGrace = resolve; }));
    render(<MemoryRouter><LookupPanel client={{ lookup } as any} /></MemoryRouter>);
    const input = screen.getByLabelText(/player name/i);
    fireEvent.change(input, { target: { value: 'Ada' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Grace' } });
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByRole('status')).toHaveTextContent('Searching registrations...');
    await act(async () => { resolveGrace([grace]); await Promise.resolve(); });
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('keeps the query when retrying a failed lookup', async () => {
    const lookup = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 'r1', playerName: 'Ada Lovelace', bibNumber: 7, checkedIn: false }]);
    render(<MemoryRouter><LookupPanel client={{ lookup } as any} /></MemoryRouter>);
    const input = screen.getByLabelText(/player name/i);
    fireEvent.change(input, { target: { value: 'Ada' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not search registrations/i);
    expect(input).toHaveValue('Ada');
    fireEvent.click(screen.getByRole('button', { name: 'Retry lookup' }));
    expect(await screen.findByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(lookup.mock.calls.map(([query]) => query)).toEqual(['Ada', 'Ada']);
  });

  it('groups lookup results into stable player, number, status and action rows', async () => {
    const lookup = vi.fn().mockResolvedValue([{ id: 'r1', playerName: 'Grace Hopper', bibNumber: 7, checkedIn: true }]);
    render(<MemoryRouter><LookupPanel client={{ lookup } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/player name/i), { target: { value: 'Grace' } });

    const row = await screen.findByRole('listitem');
    expect(row).toHaveClass('lookup-result');
    expect(within(row).getByText('Grace Hopper')).toBeInTheDocument();
    expect(within(row).getByText('Number 7')).toBeInTheDocument();
    expect(within(row).getByText('Already checked in')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Check in again' })).toBeInTheDocument();
  });

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
