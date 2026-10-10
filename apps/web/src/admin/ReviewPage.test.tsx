import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReviewPage } from './ReviewPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ReviewPage', () => {
  it('confirms a withdrawal before applying it', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const withdrawRegistration = vi.fn().mockResolvedValue({ status: 'WITHDRAWN' });
    const client = {
      listReview: vi.fn().mockResolvedValue([{ id: 'i1', reason: 'age_out_of_range', registration: { id: 'r1', playerName: 'Ada Lovelace' } }]),
      withdrawRegistration,
    };
    render(<ReviewPage client={client as any} eventId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
    expect(confirm).toHaveBeenCalled();
    expect(withdrawRegistration).toHaveBeenCalledWith('e1', 'r1');
  });

  it('lists flagged registrations and lets an admin resolve one', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ id: 'i1', resolvedAt: '2026-09-01T00:00:00Z' });
    const client = {
      listReview: vi.fn().mockResolvedValue([
        {
          id: 'i1',
          reason: 'age_out_of_range',
          registration: { playerName: 'Ada Lovelace' },
        },
      ]),
      resolveReview,
    };
    render(<ReviewPage client={client as any} eventId="e1" />);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    (await screen.findByRole('button', { name: /mark reviewed/i })).click();
    expect(resolveReview).toHaveBeenCalledWith('e1', 'i1', expect.any(String));
  });
});
