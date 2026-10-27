import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventsPage } from './EventsPage';

afterEach(() => cleanup());

describe('EventsPage', () => {
  it('retries the events request after a load failure', async () => {
    const listEvents = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([
      { id: 'e1', name: '15/U Ladies', eventDate: '2026-09-12', courts: 5 },
    ]);
    render(<MemoryRouter><EventsPage client={{ listEvents } as any} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry loading events' }));
    expect(await screen.findByText('15/U Ladies')).toBeInTheDocument();
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('lists events with their date and court count', async () => {
    const events = [{ id: 'e1', name: '15/U Ladies', eventDate: '2026-09-12', courts: 5 }];
    render(<MemoryRouter><EventsPage client={{ listEvents: async () => events } as any} /></MemoryRouter>);
    expect(await screen.findByText('15/U Ladies')).toBeTruthy();
    expect(screen.getByText(/5 courts/)).toHaveTextContent(/^12 September 2026 · /);
    expect(screen.getByRole('link', { name: 'New event' })).toHaveClass('events-new-action');
  });
});
