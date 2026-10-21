import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketPage } from './TicketPage';

describe('TicketPage', () => {
  it('renders the player name and event', async () => {
    render(<TicketPage client={{
      getTicket: async () => ({ playerName: 'Ada Lovelace', bibNumber: 42, qrCode: 'data:image/png;base64,YWJj', event: { name: '15/U Ladies', eventDate: '2026-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', gameStartTime: '09:00' } }),
      ticketCalendarUrl: (token: string) => `/api/public/ticket/${token}/calendar`,
    } as any} token="opaque-token" />);
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('15/U Ladies')).toBeInTheDocument();
    expect(screen.getByText('12 September 2026')).toBeInTheDocument();
    expect(screen.getByText('Arrival time 08:30')).toBeInTheDocument();
    expect(screen.getByText('Start time 09:00')).toBeInTheDocument();
    expect(screen.getByText('Number 42')).toBeInTheDocument();
    expect(screen.queryByText(/Bib 42/i)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /check-in qr code for ada lovelace/i })).toHaveAttribute('src', 'data:image/png;base64,YWJj');
    expect(screen.getByRole('link', { name: /download calendar/i })).toHaveAttribute('href', '/api/public/ticket/opaque-token/calendar');
    expect(screen.queryByText(/anne@example.com/)).not.toBeInTheDocument();
  });
});
