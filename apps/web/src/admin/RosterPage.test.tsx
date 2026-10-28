import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RosterPage } from './RosterPage';
import { ApiError } from '../api/client';

const originalCreateObjectURL = URL.createObjectURL;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
  else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
});

const roster = {
  eventId: 'event-1',
  positionCounts: { rank1: { GS: 2 }, rank2: { WA: 1 }, rank3: { C: 1 }, extraOptIn: 1 },
  registrations: [{
    id: 'reg-1', playerName: 'Ada Lovelace', dateOfBirth: '2012-04-02', parentName: 'Anne',
    parentEmail: 'anne@example.com', parentMobile: '0400000000', memberAssociation: 'MENA',
    rank1Position: 'GS', rank2Position: 'WA', rank3Position: null, optInExtraPositions: true,
    ageFlagged: false, status: 'PAID', amountCents: 3500, currency: 'aud', bibNumber: 4,
    checkedInAt: '2026-09-12T00:00:00.000Z',
  }],
};

function renderPage(client: Record<string, unknown>) {
  return render(<MemoryRouter><RosterPage client={client as any} eventId="event-1" /></MemoryRouter>);
}

describe('RosterPage', () => {
  it('shows choice counts and minimal contact/payment/check-in data', async () => {
    renderPage({ getRoster: vi.fn().mockResolvedValue(roster), downloadRoster: vi.fn() });
    expect(await screen.findByRole('heading', { name: /roster/i })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Event roster' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Scroll horizontally to view all roster details.')).toBeInTheDocument();
    expect(screen.getByText('anne@example.com')).toBeInTheDocument();
    expect(screen.getByText(/\$35\.00/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    expect(screen.queryByText(/bib 4/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First choice' })).toBeInTheDocument();
    expect(screen.getByText('GS: 2')).toBeInTheDocument();
  });

  it('shows a genuine empty state and retries a roster load error', async () => {
    const getRoster = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      ...roster, registrations: [],
    });
    renderPage({ getRoster, downloadRoster: vi.fn() });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the roster/i);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/no registrations for this event/i)).toBeInTheDocument();
    expect(getRoster).toHaveBeenCalledTimes(2);
  });

  it('downloads a CSV with the event-scoped filename and reports retention expiry', async () => {
    const downloadRoster = vi.fn().mockResolvedValueOnce(new Blob(['csv']))
      .mockRejectedValueOnce(new ApiError(410, 'roster_retention_expired'));
    const createObjectURL = vi.fn().mockReturnValue('blob:roster');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    const clickedNames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedNames.push(this.download);
    });
    renderPage({ getRoster: vi.fn().mockResolvedValue(roster), downloadRoster });
    fireEvent.click(await screen.findByRole('button', { name: /download roster csv/i }));
    await waitFor(() => expect(clickedNames).toEqual(['roster-event-1.csv']));
    fireEvent.click(screen.getByRole('button', { name: /download roster csv/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/export period has ended/i);
  });
});
