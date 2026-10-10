import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../api/client';
import { EventFormPage } from './EventFormPage';

afterEach(cleanup);

function renderForm(client: Record<string, unknown>) {
  return render(<MemoryRouter><EventFormPage client={client as any} /></MemoryRouter>);
}

describe('EventFormPage', () => {
  it('sets policy age defaults when the division is selected', () => {
    renderForm({ createEvent: vi.fn() });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: '15/U' } });
    expect(screen.getByLabelText(/minimum age/i)).toHaveValue(12);
    expect(screen.getByLabelText(/maximum age/i)).toHaveValue(15);
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'All Abilities' } });
    expect(screen.getByLabelText(/minimum age/i)).toHaveValue(10);
  });

  it('shows fees in dollars, submits cents, and focuses a server-error summary', async () => {
    const createEvent = vi.fn().mockRejectedValue(new ApiError(400, 'validation_failed', ['eventDate', 'registrationFeeCents']));
    renderForm({ createEvent });
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: '15/U Ladies' } });
    fireEvent.change(screen.getByLabelText('Registration fee (AUD)'), { target: { value: '35.00' } });
    fireEvent.click(screen.getByRole('button', { name: /save event/i }));
    const summary = await screen.findByRole('alert', { name: /check these event details/i });
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(screen.getByLabelText('Event date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Registration fee (AUD)')).toHaveAttribute('aria-invalid', 'true');
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ registrationFeeCents: 3500 }));
    expect(screen.getByLabelText('Event name')).toHaveValue('15/U Ladies');
  });
});
