import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EventDTO, RoundPlanDTO } from '@netball-trials/types';
import { PlannerPage } from './PlannerPage';

afterEach(cleanup);

const event = {
  id: 'e1', name: 'Trials', competitionYear: 2027, division: '15/U', section: 'Ladies',
  eventDate: '2027-09-12T00:00:00.000Z', venue: 'SNC', startTime: '08:30', endTime: '12:00',
  firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 2,
  rank1Min: 1, rank2Min: 0, rank3Min: 0, playMinutes: 8, changeoverMinutes: 2,
  minAge: 12, maxAge: 15, policyUrl: null, policyDocumentName: null, status: 'OPEN',
} satisfies EventDTO;

function plan(status: 'DRAFT' | 'PUBLISHED' = 'DRAFT'): RoundPlanDTO {
  return {
    id: 'plan-1', eventId: 'e1', status, revision: 2, sourcePlanId: null, frozenThroughRound: 0,
    seed: 1, rounds: 2, courts: 2, playMinutes: 8, changeoverMinutes: 2, windowMinutes: 150,
    rank1Min: 1, rank2Min: 0, rank3Min: 0, eventName: 'Trials', eventDate: event.eventDate,
    venue: 'SNC', firstWhistle: '09:00', createdAt: '2026-10-10T00:00:00.000Z', publishedAt: status === 'PUBLISHED' ? '2026-10-10T00:00:00.000Z' : null,
    slots: [{ id: 'slot-1', round: 1, court: 1, position: 'GS', team: 0, registrationId: 'r1', playerName: 'Ada Lovelace', bibNumber: 5 }],
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return { checkedInPlayers: 28, minimumRounds: 2, requiredMinutes: 18, windowMinutes: 150, fitsTimeWindow: true, ...overrides };
}

function renderPlanner(client: Record<string, unknown>) {
  return render(<MemoryRouter><PlannerPage client={{ getPublishedPlan: vi.fn().mockResolvedValue(null), ...client } as any} eventId="e1" /></MemoryRouter>);
}

describe('PlannerPage', () => {
  it('shows settings, lower-bound rounds and time/window preview, then preserves infeasibility gaps', async () => {
    const client = {
      getEvent: vi.fn().mockResolvedValue(event),
      getPlan: vi.fn().mockResolvedValue(null),
      getPlanPreview: vi.fn().mockResolvedValue(preview()),
      generatePlan: vi.fn().mockResolvedValue({ ok: false, gaps: [{ code: 'too_few_players', message: '20 players cannot fill 2 courts (need 28)' }] }),
    };
    renderPlanner(client);
    expect(await screen.findByText(/28 checked-in players/i)).toBeInTheDocument();
    expect(screen.getByText(/minimum round lower bound: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/18 minutes.*150-minute window/i)).toBeInTheDocument();
    expect(screen.getByText(/2 courts.*8-minute games.*rank minimums 1\/0\/0/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot fill 2 courts/i);
    expect(screen.getByText(/adjust event settings or the checked-in roster/i)).toBeInTheDocument();
  });

  it('previews draft slots and only enables print after a published revision exists', async () => {
    const client = {
      getEvent: vi.fn().mockResolvedValue(event),
      getPlanPreview: vi.fn().mockResolvedValue(preview()),
      getPlan: vi.fn().mockResolvedValue(plan('DRAFT')),
      publishPlan: vi.fn().mockResolvedValue({ ok: true, plan: plan('PUBLISHED') }),
      regeneratePlan: vi.fn().mockResolvedValue({ ok: true, plan: plan('DRAFT') }),
    };
    renderPlanner(client);
    expect(await screen.findByText(/Draft revision 2 · 2 rounds/i)).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /print selector sheets/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /publish revision/i }));
    expect(await screen.findByRole('link', { name: /print selector sheets/i })).toHaveAttribute('href', '/admin/events/e1/sheets');
    expect(screen.getByText('Published revision 2 · 2 rounds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate suffix/i })).toBeInTheDocument();
  });

  it('renders API load and publish failures without losing the settings summary', async () => {
    const client = {
      getEvent: vi.fn().mockResolvedValue(event),
      getPlanPreview: vi.fn().mockResolvedValue(preview({ fitsTimeWindow: false, requiredMinutes: 170 })),
      getPlan: vi.fn().mockResolvedValue(plan('DRAFT')),
      publishPlan: vi.fn().mockResolvedValue({ ok: false, gaps: [{ code: 'time_window', message: '170 minutes needed but the window is 150' }] }),
    };
    renderPlanner(client);
    expect(await screen.findByText(/170 minutes.*150-minute window/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /publish revision/i }));
    expect(await screen.findByText(/170 minutes needed/i)).toBeInTheDocument();
    expect(screen.getByText(/Trials/)).toBeInTheDocument();
  });
});
