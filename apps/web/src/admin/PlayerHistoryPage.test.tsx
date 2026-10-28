import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PlayerHistoryEntryDTO } from '@netball-trials/types';
import { PlayerHistoryPage } from './PlayerHistoryPage';

afterEach(() => cleanup());

const entries: PlayerHistoryEntryDTO[] = [
  {
    registrationId: 'reg-15u', playerName: 'Ada Lovelace', eventId: 'e15', eventName: '15/U Ladies', eventDate: '2025-09-12',
    competitionYear: 2025, division: '15/U', section: 'Ladies', association: 'MENA', rank1Position: 'GS', rank2Position: 'GA', rank3Position: 'WA',
    registrationStatus: 'PAID', checkedIn: true, number: 12, ageFlagged: false, games: 4, courtsSeen: [1, 2, 3],
    positionsPlayed: { GS: 2, GA: 1, WA: 1 }, uniqueOpponents: 28, repeatOpponentMeetings: 4,
  },
  {
    registrationId: 'reg-17u', playerName: 'Ada Lovelace', eventId: 'e17', eventName: '17/U Ladies', eventDate: '2026-09-12',
    competitionYear: 2026, division: '17/U', section: 'Ladies', association: 'MENA', rank1Position: 'C', rank2Position: 'WD', rank3Position: null,
    registrationStatus: 'PAID', checkedIn: false, number: null, ageFlagged: false, games: 0, courtsSeen: [],
    positionsPlayed: {}, uniqueOpponents: 0, repeatOpponentMeetings: 0,
  },
];

describe('PlayerHistoryPage', () => {
  it('searches by exact player name and birth date and shows only trial-relevant history', async () => {
    const searchPlayerHistory = vi.fn().mockResolvedValue(entries);
    render(<MemoryRouter><PlayerHistoryPage client={{ searchPlayerHistory } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Player full name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2011-04-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search history' }));

    expect(await screen.findByRole('heading', { name: 'Possible matching registrations' })).toBeInTheDocument();
    expect(searchPlayerHistory).toHaveBeenCalledWith('Ada Lovelace', '2011-04-02');
    expect(screen.getByRole('row', { name: /2025-09-12.*15\/U Ladies/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /2026-09-12.*17\/U Ladies/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /2025-09-12/ })).toHaveTextContent('Number 12');
    expect(screen.getByText(/28/)).toBeInTheDocument();
    expect(screen.getByText(/confirm these records are for the same player/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/parent@example|paymentIntentId|amountCents/i);
  });

  it('does not imply permanent profile linkage when there are no matches', async () => {
    const searchPlayerHistory = vi.fn().mockResolvedValue([]);
    render(<MemoryRouter><PlayerHistoryPage client={{ searchPlayerHistory } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Player full name'), { target: { value: 'Unknown Player' } });
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2012-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search history' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/no matching registrations within the four-year history period/i);
    await waitFor(() => expect(searchPlayerHistory).toHaveBeenCalledOnce());
  });
});
