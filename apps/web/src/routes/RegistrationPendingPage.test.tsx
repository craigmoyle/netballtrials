import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RegistrationPendingPage } from './RegistrationPendingPage';

afterEach(() => vi.useRealTimers());

describe('RegistrationPendingPage', () => {
  it('stops polling when the Checkout session reaches a terminal status', async () => {
    vi.useFakeTimers();
    const getRegistrationStatus = vi.fn().mockResolvedValue({ status: 'EXPIRED' });
    render(
      <RegistrationPendingPage
        client={{ getRegistrationStatus } as any}
        checkoutSessionId="cs_opaque"
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: /payment not completed/i })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(getRegistrationStatus).toHaveBeenCalledTimes(1);
  });
});
