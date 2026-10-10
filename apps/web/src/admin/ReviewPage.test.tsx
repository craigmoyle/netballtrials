import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewPage } from './ReviewPage';

describe('ReviewPage', () => {
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
