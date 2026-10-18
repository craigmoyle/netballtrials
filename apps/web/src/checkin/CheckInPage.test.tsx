import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('shows the PIN form without looking up an event when no ID is prefilled', () => {
    const listPublicEvents = vi.fn();
    renderCheckIn({ listPublicEvents });
    expect(screen.getByLabelText(/event pin/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /start check-in/i })).toBeTruthy();
    expect(listPublicEvents).not.toHaveBeenCalled();
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
