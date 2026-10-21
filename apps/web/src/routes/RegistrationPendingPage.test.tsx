import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RegistrationPendingPage } from './RegistrationPendingPage';

afterEach(() => vi.useRealTimers());

function renderPending(getRegistrationStatus: ReturnType<typeof vi.fn>) {
  return render(<MemoryRouter><RegistrationPendingPage client={{ getRegistrationStatus } as any} checkoutSessionId="cs_opaque" /></MemoryRouter>);
}

describe('RegistrationPendingPage', () => {
  it('shows the paid QR ticket and calendar download, then stops polling', async () => {
    vi.useFakeTimers();
    const getRegistrationStatus = vi.fn().mockResolvedValue({
      status: 'PAID', ticketPath: '/ticket/opaque-token', calendarUrl: 'https://api.example/calendar.ics',
      ticket: { playerName: 'Ada Lovelace', qrCode: 'data:image/png;base64,YWJj', event: { name: 'Trials', eventDate: '2026-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30' } },
    });
    renderPending(getRegistrationStatus);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: /payment received/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /check-in qr code for ada lovelace/i })).toHaveAttribute('src', 'data:image/png;base64,YWJj');
    expect(screen.getByText('12 September 2026 · arrival 08:30 · SNC')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open ticket/i })).toHaveAttribute('href', '/ticket/opaque-token');
    expect(screen.getByRole('link', { name: /download calendar/i })).toHaveAttribute('href', 'https://api.example/calendar.ics');
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(getRegistrationStatus).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the Checkout session reaches a terminal status', async () => {
    vi.useFakeTimers();
    const getRegistrationStatus = vi.fn().mockResolvedValue({ status: 'EXPIRED' });
    renderPending(getRegistrationStatus);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: /payment not completed/i })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(getRegistrationStatus).toHaveBeenCalledTimes(1);
  });

  it('treats withdrawn status as terminal', async () => {
    vi.useFakeTimers();
    const getRegistrationStatus = vi.fn().mockResolvedValue({ status: 'WITHDRAWN' });
    renderPending(getRegistrationStatus);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: /registration not active/i })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(getRegistrationStatus).toHaveBeenCalledTimes(1);
  });
});
