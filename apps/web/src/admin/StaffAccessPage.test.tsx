import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StaffAccessPage } from './StaffAccessPage';

afterEach(() => cleanup());

describe('StaffAccessPage', () => {
  it('sends an invitation and clears the email field', async () => {
    const inviteStaff = vi.fn().mockResolvedValue({ status: 'sent' });
    render(<MemoryRouter><StaffAccessPage client={{ inviteStaff } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/committee member email/i), { target: { value: 'New.Admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(inviteStaff).toHaveBeenCalledWith('New.Admin@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent(/invitation sent/i);
    expect(screen.getByLabelText(/committee member email/i)).toHaveValue('');
  });

  it('keeps the address and offers retry when sending fails', async () => {
    const inviteStaff = vi.fn().mockRejectedValue(new Error('offline'));
    render(<MemoryRouter><StaffAccessPage client={{ inviteStaff } as any} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/committee member email/i), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not send the invitation/i);
    expect(screen.getByLabelText(/committee member email/i)).toHaveValue('admin@example.com');
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled();
  });
});
