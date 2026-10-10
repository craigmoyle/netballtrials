import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlannerPage } from './PlannerPage';

describe('PlannerPage', () => {
  it('lists the gaps when generation is infeasible', async () => {
    const client = {
      generatePlan: vi.fn().mockResolvedValue({
        ok: false,
        gaps: [{ code: 'too_few_players', message: '20 players cannot fill 2 courts (need 28)' }],
      }),
      getPlan: vi.fn().mockResolvedValue(null),
    };
    render(<PlannerPage client={client as any} eventId="e1" />);
    (await screen.findByRole('button', { name: /generate/i })).click();
    expect(await screen.findByText(/cannot fill 2 courts/)).toBeTruthy();
  });
});
