import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketPage } from './TicketPage';

describe('TicketPage', () => {
  it('renders the player name and event', async () => {
    render(<TicketPage client={{ getTicket: async () => ({ playerName: 'Ada Lovelace', event: { name: '15/U Ladies' } }) } as any} token="t" />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('15/U Ladies')).toBeTruthy();
  });
});
