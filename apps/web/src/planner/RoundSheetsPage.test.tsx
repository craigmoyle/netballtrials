import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RoundSheetsPage } from './RoundSheetsPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const event = { id: 'event-1', name: '15/U Trials', eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', gameStartTime: '09:00' };
const player = { registrationId: 'player-1', playerName: 'Briar Ashford', bibNumber: 12 };
const opponent = { registrationId: 'player-2', playerName: 'Grace Pickering', bibNumber: 13 };
const plan = {
  id: 'plan-1', status: 'PUBLISHED', eventId: 'event-1', eventName: event.name, rounds: 2, courts: 2,
  players: [player, opponent],
  slots: [
    { round: 1, court: 1, position: 'GS', team: 0, registrationId: player.registrationId, playerName: player.playerName, bibNumber: player.bibNumber },
    { round: 1, court: 1, position: 'GS', team: 1, registrationId: opponent.registrationId, playerName: opponent.playerName, bibNumber: opponent.bibNumber },
    { round: 2, court: 2, position: 'GA', team: 1, registrationId: player.registrationId, playerName: player.playerName, bibNumber: player.bibNumber },
  ],
};

function renderPage(client: Record<string, unknown>) {
  render(<MemoryRouter><RoundSheetsPage client={client as any} eventId="event-1" /></MemoryRouter>);
}

describe('RoundSheetsPage', () => {
  it('prints one sheet per round and lets the Admin compare portrait and landscape layouts', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderPage({ getEvent: vi.fn().mockResolvedValue(event), getPublishedPlan: vi.fn().mockResolvedValue(plan) });

    const firstRound = await screen.findByRole('article', { name: '15/U Trials — Round 1' });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    const court = within(firstRound).getByRole('region', { name: 'Court 1' });
    expect(within(court).getByText('Briar Ashford')).toBeInTheDocument();
    expect(within(court).getByText('Number 12')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Landscape' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Portrait' }));
    expect(screen.getByRole('radio', { name: 'Portrait' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Round handout preview' })).toHaveAttribute('data-orientation', 'portrait');
    fireEvent.click(screen.getByRole('button', { name: 'Print round handouts' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('prompts the Admin to publish a plan before printing', async () => {
    renderPage({ getEvent: vi.fn().mockResolvedValue(event), getPublishedPlan: vi.fn().mockResolvedValue(null) });
    expect(await screen.findByText(/publish a round plan before printing handouts/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Plan rounds' })).toHaveAttribute('href', '/admin/events/event-1/plan');
    expect(screen.queryByRole('button', { name: 'Print round handouts' })).not.toBeInTheDocument();
  });
});
