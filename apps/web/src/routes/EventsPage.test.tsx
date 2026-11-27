import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

  it('prompts for fresh dates and navigates to the new DRAFT clone', async () => {
    const event = { id: 'e1', name: '15/U Ladies', eventDate: '2026-09-12', courts: 5, division: '15/U', section: 'Ladies', status: 'CLOSED' };
    const cloned = { ...event, id: 'e2', eventDate: '2027-09-19T00:00:00.000Z', status: 'DRAFT' };
    const cloneEvent = vi.fn().mockResolvedValue(cloned);
    function CurrentPath() { return <output aria-label="Current path">{useLocation().pathname}</output>; }
    render(<MemoryRouter initialEntries={['/admin/events']}><EventsPage client={{ listEvents: async () => [event], cloneEvent } as any} /><CurrentPath /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Clone for next year' }));
    fireEvent.change(screen.getByLabelText('Competition year for clone'), { target: { value: '2028' } });
    fireEvent.change(screen.getByLabelText('Event date for clone'), { target: { value: '2027-09-19' } });
    fireEvent.change(screen.getByLabelText('Registration closes for clone'), { target: { value: '2027-09-17T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create DRAFT clone' }));

    await screen.findByText('/admin/events/e2');
    expect(cloneEvent).toHaveBeenCalledWith('e1', {
      competitionYear: 2028, eventDate: '2027-09-19', registrationClosesAt: '2027-09-17T18:00',
    });
  });

  it('lists events with their date and court count', async () => {
    const events = [{ id: 'e1', name: '15/U Ladies', eventDate: '2026-09-12', courts: 5 }];
    render(<MemoryRouter><EventsPage client={{ listEvents: async () => events } as any} /></MemoryRouter>);
    expect(await screen.findByText('15/U Ladies')).toBeTruthy();
    expect(screen.getByText(/5 courts/)).toHaveTextContent(/^12 September 2026 · /);
    expect(screen.getByRole('link', { name: 'New event' })).toHaveClass('events-new-action');
  });
});
