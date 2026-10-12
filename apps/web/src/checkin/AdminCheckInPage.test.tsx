import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AdminCheckInPage } from './AdminCheckInPage';

function CurrentPath() {
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function AdminCheckInRoute({ client }: { client: Record<string, unknown> }) {
  const { id } = useParams();
  return <AdminCheckInPage client={client as any} eventId={id!} />;
}

describe('AdminCheckInPage', () => {
  it('retries after a failed Admin session start', async () => {
    const openAdminCheckIn = vi.fn().mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce({ eventName: 'E2E Check-in' });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/admin/events/event-1/check-in']}>
          <Routes>
            <Route path="/admin/events/:id/check-in" element={<AdminCheckInRoute client={{ openAdminCheckIn }} />} />
            <Route path="/check-in/scan" element={<h1>Scanner ready</h1>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start Admin check-in.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Scanner ready' })).toBeInTheDocument();
    expect(openAdminCheckIn).toHaveBeenCalledTimes(2);
  });

  it('starts the event-scoped Admin session and opens the existing scanner', async () => {
    const openAdminCheckIn = vi.fn().mockResolvedValue({ eventName: 'E2E Check-in' });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/admin/events/event-1/check-in']}>
          <Routes>
            <Route path="/admin/events/:id/check-in" element={<AdminCheckInRoute client={{ openAdminCheckIn }} />} />
            <Route path="/check-in/scan" element={<h1>Scanner ready</h1>} />
          </Routes>
          <CurrentPath />
        </MemoryRouter>
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', { name: 'Scanner ready' })).toBeInTheDocument();
    expect(openAdminCheckIn).toHaveBeenCalledTimes(1);
    expect(openAdminCheckIn).toHaveBeenCalledWith('event-1');
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/check-in/scan');
  });
});
