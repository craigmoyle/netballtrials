import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegistrationOverviewPage } from './RegistrationOverviewPage';

afterEach(cleanup);

const event = {
  id: 'event-1', name: '15/U Ladies', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2027-09-12T00:00:00.000Z', startTime: '08:30', paidRegistrations: 22, paidWithdrawals: 0, pendingRegistrations: 3,
  daysUntilStart: 11,
  priorYears: [
    { competitionYear: 2026, paidRegistrationsAtSameLeadTime: 30 },
    { competitionYear: 2025, paidRegistrationsAtSameLeadTime: 25 },
  ],
};

function renderPage(getRegistrationOverview: ReturnType<typeof vi.fn>) {
  render(<MemoryRouter><RegistrationOverviewPage client={{ getRegistrationOverview } as any} /></MemoryRouter>);
}

describe('RegistrationOverviewPage', () => {
  it('compares open-event paid sign-ups with previous years at the same lead time', async () => {
    renderPage(vi.fn().mockResolvedValue([event]));

    const table = await screen.findByRole('table', { name: 'Open event registration totals' });
    const row = within(table).getByRole('row', { name: /15\/U Ladies15\/U/ });
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '12 September 2027', '11', '22', '0', '3', '28', '6 fewer',
    ]);
    expect(within(row).getByRole('link', { name: '15/U Ladies' })).toHaveAttribute('href', '/admin/events/event-1/roster');

    fireEvent.click(screen.getByText('15/U Ladies: previous years'));
    const history = screen.getByRole('table', { name: 'Paid registrations at the same lead time as 2027' });
    expect(within(history).getByRole('row', { name: '2026 30' })).toBeInTheDocument();
    expect(within(history).getByRole('row', { name: '2025 25' })).toBeInTheDocument();
  });

  it('shows a clear empty state when no events are open', async () => {
    renderPage(vi.fn().mockResolvedValue([]));
    expect(await screen.findByText(/no events are currently open for registration/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View events' })).toHaveAttribute('href', '/admin/events');
  });
});
