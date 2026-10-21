import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CheckInPage } from './CheckInPage';

afterEach(() => { cleanup(); });

function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current URL">{pathname}{search}</output>;
}

function renderCheckIn(client: Record<string, unknown>, path = '/check-in') {
  return render(<MemoryRouter initialEntries={[path]}><CheckInPage client={client as any} /><CurrentLocation /></MemoryRouter>);
}

describe('CheckInPage', () => {
  it('lets volunteers choose an upcoming trial before entering the PIN', async () => {
    const events = [
      {
        id: 'event-42', name: '17/U State Titles Trial', eventDate: '2026-09-12T00:00:00.000Z',
        venue: 'Chisholm Netball Centre', status: 'CLOSED',
      },
      {
        id: 'event-43', name: '15/U Ladies Trial', eventDate: '2026-09-19T00:00:00.000Z',
        venue: 'Riverside Courts', status: 'OPEN',
      },
    ];
    const listPublicEvents = vi.fn().mockResolvedValue(events);
    renderCheckIn({ listPublicEvents });

    expect(await screen.findByRole('option', {
      name: '17/U State Titles Trial · 12 September 2026 · Chisholm Netball Centre',
    })).toBeInTheDocument();
    const trialSelect = screen.getByLabelText('Trial');
    expect(screen.getByRole('option', {
      name: '15/U Ladies Trial · 19 September 2026 · Riverside Courts',
    })).toBeInTheDocument();
    expect(trialSelect).toHaveValue('');
    expect(trialSelect).not.toHaveTextContent(/OPEN|CLOSED/);
    expect(screen.getByLabelText(/event pin/i)).toBeTruthy();
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
  });

  it('opens check-in for the selected trial and PIN', async () => {
    const event = {
      id: 'event-42', name: '17/U State Titles Trial', eventDate: '2026-09-12T00:00:00.000Z',
      venue: 'Chisholm Netball Centre', status: 'OPEN',
    };
    const openCheckIn = vi.fn().mockResolvedValue({ eventName: event.name });
    renderCheckIn({ listPublicEvents: vi.fn().mockResolvedValue([event]), openCheckIn });

    // The selector is disabled until the trial list loads; wait for the option first.
    await screen.findByRole('option', { name: /17\/U State Titles Trial/ });
    fireEvent.change(screen.getByLabelText('Trial'), { target: { value: event.id } });
    fireEvent.change(screen.getByLabelText('Event PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start check-in' }));

    await waitFor(() => expect(openCheckIn).toHaveBeenCalledWith(event.id, '1234'));
    await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent('/check-in/scan'));
  });

  it('explains when there are no upcoming trials to choose', async () => {
    renderCheckIn({ listPublicEvents: vi.fn().mockResolvedValue([]) });

    expect(await screen.findByText(/no upcoming trials are available/i)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: /start check-in/i })).toBeDisabled();
  });

  it('offers a retry when upcoming trials cannot be loaded', async () => {
    const event = {
      id: 'event-42', name: '17/U State Titles Trial', eventDate: '2026-09-12T00:00:00.000Z',
      venue: 'Chisholm Netball Centre', status: 'CLOSED',
    };
    const listPublicEvents = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([event]);
    renderCheckIn({ listPublicEvents });

    expect(await screen.findByText(/could not load upcoming trials/i)).toHaveAttribute('role', 'alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('option', { name: /17\/u state titles trial/i })).toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledTimes(2);
  });

  it('shows the name and localized date for the event-specific volunteer link', async () => {
    const event = { id: 'event-42', name: '17/U State Titles Trial', eventDate: '2026-09-12T00:00:00.000Z' };
    const listPublicEvents = vi.fn().mockResolvedValue([event]);
    const openCheckIn = vi.fn();
    renderCheckIn({ listPublicEvents, openCheckIn }, '/check-in?eventId=event-42');

    expect(await screen.findByText('17/U State Titles Trial · 12 September 2026')).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('Event ID')).toHaveValue('event-42');
    expect(screen.getByLabelText('Event PIN')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/check-in?eventId=event-42');
    expect(screen.getByLabelText('Current URL')).not.toHaveTextContent(/pin/i);
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
    expect(openCheckIn).not.toHaveBeenCalled();
  });

  it('clears the verified event when the prefilled ID is edited', async () => {
    const event = { id: 'event-42', name: '17/U State Titles Trial', eventDate: '2026-09-12T00:00:00.000Z' };
    const listPublicEvents = vi.fn().mockResolvedValue([event]);
    renderCheckIn({ listPublicEvents }, '/check-in?eventId=event-42');
    await screen.findByText('17/U State Titles Trial · 12 September 2026');

    fireEvent.change(screen.getByLabelText('Event ID'), { target: { value: 'event-99' } });

    expect(screen.queryByText(/17\/U State Titles Trial/)).not.toBeInTheDocument();
    expect(screen.getByText(/confirm the event id with your coordinator/i)).toHaveAttribute('role', 'status');
    expect(listPublicEvents).toHaveBeenCalledTimes(1);
  });

  it('shows a non-blocking verification message when the ID is not publicly listed', async () => {
    renderCheckIn({ listPublicEvents: vi.fn().mockResolvedValue([]) }, '/check-in?eventId=event-42');

    expect(await screen.findByText(/confirm the event id with your coordinator/i)).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('Event PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start check-in/i })).toBeEnabled();
  });

  it('shows a non-blocking verification message when the public lookup fails', async () => {
    renderCheckIn({ listPublicEvents: vi.fn().mockRejectedValue(new Error('offline')) }, '/check-in?eventId=event-42');

    expect(await screen.findByText(/confirm the event id with your coordinator/i)).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('Event PIN')).toHaveAttribute('type', 'password');
  });
});
