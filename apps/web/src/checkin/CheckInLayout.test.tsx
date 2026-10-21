import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CheckInSummary } from '@netball-trials/types';
import { ApiError } from '../api/client';
import { CheckInLayout } from './CheckInLayout';
import { notifyCheckInUpdated } from './refresh';

afterEach(cleanup);

const summary = (checkedIn: number): CheckInSummary => ({ eventId: 'e1', eventName: 'Trials', registered: 3, checkedIn, closed: false });

function renderLayout(client: { checkInSummary: () => Promise<CheckInSummary> }) {
  render(
    <MemoryRouter initialEntries={['/check-in/scan']}>
      <Routes>
        <Route path="/check-in" element={<p>Check-in sign in</p>} />
        <Route path="/check-in/scan" element={<CheckInLayout client={client as any} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CheckInLayout', () => {
  it.each([401, 403, 404, 409])('returns to check-in sign in when the session is rejected with %i', async (status) => {
    renderLayout({ checkInSummary: vi.fn().mockRejectedValue(new ApiError(status, 'rejected')) });
    expect(await screen.findByText('Check-in sign in')).toBeInTheDocument();
  });

  it('keeps the last summary when a refresh fails for a transient reason', async () => {
    const checkInSummary = vi.fn()
      .mockResolvedValueOnce(summary(1))
      .mockRejectedValueOnce(new ApiError(502, 'request_failed'))
      .mockRejectedValueOnce(new ApiError(0, 'network_error'));
    renderLayout({ checkInSummary });
    expect(await screen.findByText('1 of 3 arrived')).toBeInTheDocument();

    await act(async () => { notifyCheckInUpdated(); });
    await act(async () => { notifyCheckInUpdated(); });

    expect(checkInSummary).toHaveBeenCalledTimes(3);
    expect(screen.getByText('1 of 3 arrived')).toBeInTheDocument();
    expect(screen.queryByText('Check-in sign in')).not.toBeInTheDocument();
  });

  it('ignores a stale summary that resolves after a newer one', async () => {
    let resolveFirst!: (value: CheckInSummary) => void;
    const checkInSummary = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(summary(2));
    renderLayout({ checkInSummary });

    await act(async () => { notifyCheckInUpdated(); });
    expect(await screen.findByText('2 of 3 arrived')).toBeInTheDocument();
    await act(async () => { resolveFirst(summary(0)); });

    expect(screen.getByText('2 of 3 arrived')).toBeInTheDocument();
  });
});
