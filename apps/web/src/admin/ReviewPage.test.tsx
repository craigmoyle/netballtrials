import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReviewPage } from './ReviewPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderPage(client: Record<string, unknown>) {
  return render(<MemoryRouter><ReviewPage client={client as any} eventId="e1" /></MemoryRouter>);
}

describe('ReviewPage', () => {
  it('confirms a withdrawal before applying it', async () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    const withdrawRegistration = vi.fn().mockResolvedValue({ status: 'WITHDRAWN' });
    const client = {
      listReview: vi.fn().mockResolvedValue([{ id: 'i1', reason: 'age_out_of_range', registration: { id: 'r1', playerName: 'Ada Lovelace' } }]),
      withdrawRegistration,
    };
    renderPage(client);
    fireEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
    expect(confirm).toHaveBeenCalled();
    expect(withdrawRegistration).toHaveBeenCalledWith('e1', 'r1');
  });

  it('refreshes the open queue after a registration is withdrawn', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const listReview = vi.fn().mockResolvedValueOnce([
      { id: 'i1', reason: 'age_out_of_range', registration: { id: 'r1', playerName: 'Ada Lovelace' } },
    ]).mockResolvedValueOnce([]);
    const withdrawRegistration = vi.fn().mockResolvedValue({ status: 'WITHDRAWN' });
    renderPage({ listReview, withdrawRegistration });
    fireEvent.click(await screen.findByRole('button', { name: /withdraw/i }));
    await waitFor(() => expect(withdrawRegistration).toHaveBeenCalledWith('e1', 'r1'));
    expect(await screen.findByText(/nothing to review/i)).toBeInTheDocument();
    expect(listReview).toHaveBeenCalledTimes(2);
  });

  it('explains an orphaned payment, shows its note, and does not offer withdrawal', async () => {
    const client = {
      listReview: vi.fn().mockResolvedValue([{
        id: 'i2', reason: 'payment_without_registration', note: 'Stripe payment pi_123',
        registration: { id: 'r2', playerName: 'Grace Hopper' },
      }]),
    };
    renderPage(client);
    expect(await screen.findByText(/payment needs review.*compare the recorded note and stripe status/i)).toBeInTheDocument();
    expect(screen.getByText('Stripe payment pi_123')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it('loads resolved notes into a read-only history view', async () => {
    const resolved = {
      id: 'i1', reason: 'age_out_of_range', note: 'Checked with association', resolvedAt: '2026-09-01T00:00:00Z',
      registration: { id: 'r1', playerName: 'Ada Lovelace', ageFlagged: true, bibNumber: null },
    };
    const listReview = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([resolved]);
    renderPage({ listReview });
    fireEvent.click(await screen.findByLabelText('Include resolved history'));

    expect(await screen.findByText('Checked with association')).toBeInTheDocument();
    expect(screen.getByText(/^Reviewed /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeInTheDocument();
    expect(listReview).toHaveBeenNthCalledWith(1, 'e1', false);
    expect(listReview).toHaveBeenNthCalledWith(2, 'e1', true);
  });

  it('uses the note entered when resolving a review item', async () => {
    const resolveReview = vi.fn().mockResolvedValue({ id: 'i1', resolvedAt: '2026-09-01T00:00:00Z' });
    const client = {
      listReview: vi.fn().mockResolvedValue([{ id: 'i1', reason: 'age_out_of_range', registration: { playerName: 'Ada Lovelace' } }]),
      resolveReview,
    };
    renderPage(client);
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Checked with association' } });
    fireEvent.click(await screen.findByRole('button', { name: /mark reviewed/i }));
    expect(resolveReview).toHaveBeenCalledWith('e1', 'i1', 'Checked with association');
  });
});
