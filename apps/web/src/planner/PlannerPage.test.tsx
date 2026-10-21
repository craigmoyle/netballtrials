import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EventDTO, PlannerGapDTO, RoundPlanDTO } from '@netball-trials/types';
import { PlannerPage } from './PlannerPage';
import { ApiError } from '../api/client';

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
    players: [], validationWarnings: [],
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
    expect(screen.getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Bib' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /print selector sheets/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /publish revision/i }));
    expect(await screen.findByRole('link', { name: /print selector sheets/i })).toHaveAttribute('href', '/admin/events/e1/sheets');
    expect(screen.getByText('Published revision 2 · 2 rounds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate suffix/i })).toBeInTheDocument();
    expect(client.publishPlan).toHaveBeenCalledWith('e1', 'plan-1');
  });

  it.each(['publish', 'regenerate'])('does not silently %s a newer revision created by another Admin', async (action) => {
    const draft = { ...plan(), id: 'displayed-draft', revision: 3 };
    const published = { ...plan('PUBLISHED'), id: 'displayed-published' };
    const client = {
      getEvent: vi.fn().mockResolvedValue(event), getPlanPreview: vi.fn().mockResolvedValue(preview()),
      getPlan: vi.fn().mockResolvedValue(draft), getPublishedPlan: vi.fn().mockResolvedValue(published),
      publishPlan: vi.fn().mockRejectedValue(new ApiError(409, 'stale_plan')),
      regeneratePlan: vi.fn().mockRejectedValue(new ApiError(409, 'stale_plan')),
    };
    renderPlanner(client);
    await screen.findByText('Draft revision 3 · 2 rounds');
    fireEvent.click(screen.getByRole('button', { name: action === 'publish' ? 'Publish revision' : 'Regenerate suffix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/newer revision/i);
    if (action === 'publish') expect(client.publishPlan).toHaveBeenCalledWith('e1', 'displayed-draft');
    else expect(client.regeneratePlan).toHaveBeenCalledWith('e1', 1, 'displayed-published');
    expect(screen.getByText('Draft revision 3 · 2 rounds')).toBeInTheDocument();
    expect(client.getPlan).toHaveBeenCalledTimes(1);
    expect(client.getPublishedPlan).toHaveBeenCalledTimes(1);
  });

  it.each(['publish', 'regenerate'])('preserves the displayed revisions when %s returns the API stale-source gap', async (action) => {
    const published = { ...plan('PUBLISHED'), id: 'published-1' };
    const gap = { code: 'no_solution', message: action === 'publish'
      ? 'A newer revision has been published since this draft was created. Review the current plan and regenerate if needed.'
      : 'The source plan is not the active published revision.' };
    const client = {
      getEvent: vi.fn().mockResolvedValue(event), getPlanPreview: vi.fn().mockResolvedValue(preview()),
      getPlan: vi.fn().mockResolvedValue(plan()), getPublishedPlan: vi.fn().mockResolvedValue(published),
      publishPlan: vi.fn().mockResolvedValue({ ok: false, gaps: [gap] }),
      regeneratePlan: vi.fn().mockResolvedValue({ ok: false, gaps: [gap] }),
    };
    renderPlanner(client);
    await screen.findByText('Draft revision 2 · 2 rounds');
    fireEvent.click(screen.getByRole('button', { name: action === 'publish' ? 'Publish revision' : 'Regenerate suffix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(gap.message);
    expect(screen.getByText('Draft revision 2 · 2 rounds')).toBeInTheDocument();
    expect(screen.getByText('Active published revision 2 · 2 rounds')).toBeInTheDocument();
    if (action === 'publish') expect(client.publishPlan).toHaveBeenCalledWith('e1', 'plan-1');
    else expect(client.regeneratePlan).toHaveBeenCalledWith('e1', 1, 'published-1');
    expect(client.getPlan).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['generate', 'success'], ['publish', 'success'], ['regenerate', 'success'],
    ['generate', 'gaps'], ['publish', 'gaps'], ['regenerate', 'gaps'],
    ['generate', 'failure'], ['publish', 'failure'], ['regenerate', 'failure'],
  ])('ignores a delayed %s %s after a direct event change, including its busy cleanup', async (action, outcome) => {
    type Result = { ok: true; plan: RoundPlanDTO } | { ok: false; gaps: PlannerGapDTO[] };
    let resolveOld!: (result: Result) => void;
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (result: Result) => void;
    const oldAction = new Promise<Result>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const newAction = new Promise<Result>((resolve) => { resolveNew = resolve; });
    const request = vi.fn().mockReturnValueOnce(oldAction).mockReturnValueOnce(newAction);
    const draft = { ...plan(), id: 'draft-1' };
    const nextDraft = { ...draft, id: 'draft-2', eventId: 'e2', revision: 4 };
    const client = {
      getEvent: vi.fn().mockImplementation((id) => Promise.resolve({ ...event, id, name: id === 'e1' ? 'Trials' : 'Next trials' })),
      getPlanPreview: vi.fn().mockResolvedValue(preview()),
      getPlan: vi.fn().mockResolvedValueOnce(draft).mockResolvedValueOnce(nextDraft),
      getPublishedPlan: vi.fn().mockResolvedValue(plan('PUBLISHED')),
      generatePlan: request, publishPlan: request, regeneratePlan: request,
    };
    const page = renderPlanner(client);
    await screen.findByText('Draft revision 2 · 2 rounds');
    const label = action === 'generate' ? 'Generate draft' : action === 'publish' ? 'Publish revision' : 'Regenerate suffix';
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(request).toHaveBeenCalledTimes(1);

    page.rerender(<MemoryRouter><PlannerPage client={client as any} eventId="e2" /></MemoryRouter>);
    await screen.findByText('Draft revision 4 · 2 rounds');
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(request).toHaveBeenCalledTimes(2);

    await act(async () => {
      if (outcome === 'failure') rejectOld(new ApiError(409, 'stale_plan'));
      else if (outcome === 'gaps') resolveOld({ ok: false, gaps: [{ code: 'no_solution', message: 'Old event gap' }] });
      else resolveOld({ ok: true, plan: { ...plan(action === 'publish' ? 'PUBLISHED' : 'DRAFT'), revision: 99 } });
    });

    expect(screen.getByText('Draft revision 4 · 2 rounds')).toBeInTheDocument();
    expect(screen.queryByText(/revision 99/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Working...' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    await act(async () => { resolveNew({ ok: true, plan: { ...nextDraft, revision: 5 } }); });
    expect(screen.getByText('Draft revision 5 · 2 rounds')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
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
