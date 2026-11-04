import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../api/client';
import { StaffAccessPage } from './StaffAccessPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const emptyRoster = { admins: [], maxAdmins: 5 };

describe('StaffAccessPage', () => {
  it('sends an invitation and explains that the recipient can request later links', async () => {
    const inviteStaff = vi.fn().mockResolvedValue({ status: 'sent' });
    const listStaff = vi.fn().mockResolvedValue(emptyRoster);
    render(<StaffAccessPage client={{ inviteStaff, listStaff } as any} />);
    fireEvent.change(await screen.findByLabelText(/committee member email/i), { target: { value: 'New.Admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(inviteStaff).toHaveBeenCalledWith('New.Admin@example.com'));
    expect(await screen.findByText(/Invitation sent\. They can request their own sign-in links from Admin sign-in whenever they need one/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/committee member email/i)).toHaveValue('');
  });

  it('shows current Admins, prevents self-removal and revokes another Admin on confirmation', async () => {
    const admins = [
      { id: 'self', email: 'current@example.com', createdAt: '2026-10-01T00:00:00.000Z', canRemove: false },
      { id: 'other', email: 'other@example.com', createdAt: '2026-10-02T00:00:00.000Z', canRemove: true },
    ];
    const listStaff = vi.fn().mockResolvedValue({ admins, maxAdmins: 5 });
    const removeStaff = vi.fn().mockResolvedValue(null);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StaffAccessPage client={{ listStaff, removeStaff, inviteStaff: vi.fn() } as any} />);

    expect(await screen.findByText('2 of 5 Admin accounts in use.')).toBeInTheDocument();
    expect(screen.getByText(/current@example.com — Admin since/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove other@example.com' }));

    await waitFor(() => expect(removeStaff).toHaveBeenCalledWith('other'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Their sessions and sign-in links will be revoked.'));
    expect(await screen.findByRole('status')).toHaveTextContent('other@example.com no longer has Admin access.');
    expect(screen.getByRole('list', { name: 'Current Admins' })).not.toHaveTextContent('other@example.com');
    expect(screen.queryByRole('button', { name: 'Remove current@example.com' })).not.toBeInTheDocument();
  });

  it('keeps the address and offers retry when sending fails', async () => {
    const inviteStaff = vi.fn().mockRejectedValue(new Error('offline'));
    render(<StaffAccessPage client={{ inviteStaff, listStaff: vi.fn().mockResolvedValue(emptyRoster) } as any} />);
    fireEvent.change(await screen.findByLabelText(/committee member email/i), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not send the invitation/i);
    expect(screen.getByLabelText(/committee member email/i)).toHaveValue('admin@example.com');
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled();
  });

  it('explains the five-Admin limit and prevents an extra invitation', async () => {
    const admins = Array.from({ length: 5 }, (_, index) => ({
      id: `admin-${index}`, email: `admin${index}@example.test`, createdAt: '2026-10-01T00:00:00.000Z', canRemove: index !== 0,
    }));
    render(<StaffAccessPage client={{ listStaff: vi.fn().mockResolvedValue({ admins, maxAdmins: 5 }) } as any} />);

    expect(await screen.findByText('5 of 5 Admin accounts in use.')).toBeInTheDocument();
    expect(screen.getByText(/Remove an Admin before inviting another/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/committee member email/i)).not.toBeInTheDocument();
  });

  it('shows the server limit error and keeps the address for retry', async () => {
    const inviteStaff = vi.fn().mockRejectedValue(new ApiError(409, 'admin_limit_reached'));
    render(<StaffAccessPage client={{ inviteStaff, listStaff: vi.fn().mockResolvedValue({ admins: [], maxAdmins: 5 }) } as any} />);
    fireEvent.change(await screen.findByLabelText(/committee member email/i), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/all 5 Admin places are in use/i);
    expect(screen.getByLabelText(/committee member email/i)).toHaveValue('new@example.test');
  });
});
