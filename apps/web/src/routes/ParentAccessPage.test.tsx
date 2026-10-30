import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParentRegistrationDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { ParentAccessPage } from './ParentAccessPage';

function registration(id: string, playerName: string): ParentRegistrationDTO {
  const [playerFirstName, ...lastParts] = playerName.split(' ');
  return {
    id,
    playerFirstName,
    playerLastName: lastParts.join(' '),
    playerName,
    dateOfBirth: '2012-04-02',
    parentName: 'Anne Parent',
    parentEmail: 'parent@example.test',
    parentMobile: '0400000000',
    memberAssociation: 'MENA',
    rank1Position: 'GS',
    rank2Position: null,
    rank3Position: null,
    optInExtraPositions: false,
    status: 'PENDING',
    amountCents: 3500,
    currency: 'aud',
    number: null,
    checkedInAt: null,
    ageFlagged: false,
    createdAt: '2026-10-28T00:00:00.000Z',
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    parentEmailVerifiedAt: '2026-10-28T00:00:00.000Z',
    parentFollowUpSentAt: null,
    canEdit: true,
    canWithdraw: true,
    canContinueCheckout: true,
    ticketPath: null,
    event: {
      id: `event-${id}`,
      name: 'E2E 15/U Ladies',
      eventDate: '2027-09-12',
      venue: 'SNC',
      startTime: '08:30',
      gameStartTime: '09:00',
      status: 'OPEN',
    },
  };
}

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    listParentRegistrations: vi.fn().mockRejectedValue({ status: 401 }),
    requestParentAccessLink: vi.fn().mockResolvedValue(undefined),
    verifyParentAccessToken: vi.fn().mockResolvedValue(undefined),
    confirmParentEmailChange: vi.fn().mockResolvedValue(undefined),
    updateParentRegistration: vi.fn(),
    withdrawParentRegistration: vi.fn(),
    continueParentCheckout: vi.fn(),
    completeFakePayment: vi.fn(),
    requestParentEmailChange: vi.fn(),
    logoutParent: vi.fn(),
    ...overrides,
  } as unknown as Client;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ParentAccessPage', () => {
  it('uses the same neutral response whether or not an address has registrations', async () => {
    const api = mockClient();
    render(<MemoryRouter initialEntries={['/manage-registration']}><ParentAccessPage client={api} /></MemoryRouter>);

    await screen.findByLabelText('Parent or guardian email');
    fireEvent.change(screen.getByLabelText('Parent or guardian email'), { target: { value: 'unknown@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/if this email matches a registration/i);
    expect(api.requestParentAccessLink).toHaveBeenCalledWith('unknown@example.test');
  });

  it('rejects a no-op email change without sending a link', async () => {
    const requestParentEmailChange = vi.fn();
    const api = mockClient({ listParentRegistrations: vi.fn().mockResolvedValue([registration('one', 'Ada Lovelace')]), requestParentEmailChange });
    render(<MemoryRouter initialEntries={['/manage-registration']}><ParentAccessPage client={api} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('New email address'), { target: { value: 'PARENT@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/different from the current one/i);
    expect(requestParentEmailChange).not.toHaveBeenCalled();
  });

  it('requires confirmation before withdrawal and states that there is no refund', async () => {
    const row = registration('one', 'Ada Lovelace');
    const withdrawParentRegistration = vi.fn().mockResolvedValue({ ...row, status: 'WITHDRAWN', canWithdraw: false, canEdit: false });
    const api = mockClient({ listParentRegistrations: vi.fn().mockResolvedValue([row]), withdrawParentRegistration });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter initialEntries={['/manage-registration']}><ParentAccessPage client={api} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw registration' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('No refund will be issued.'));
    expect(withdrawParentRegistration).toHaveBeenCalledWith('one');
    expect(await screen.findByText('Withdrawn. No refund is available.')).toBeInTheDocument();
  });

  it('distinguishes a failed payment and offers a new attempt while registration is open', async () => {
    const failed = { ...registration('one', 'Ada Lovelace'), status: 'FAILED' as const, canEdit: false, canWithdraw: false, canContinueCheckout: false };
    const api = mockClient({ listParentRegistrations: vi.fn().mockResolvedValue([failed]) });
    render(<MemoryRouter initialEntries={['/manage-registration']}><ParentAccessPage client={api} /></MemoryRouter>);

    expect(await screen.findByText('Payment failed. This registration is not complete.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a new registration' })).toHaveAttribute('href', '/register/event-one');
    expect(screen.queryByRole('button', { name: 'Continue to Checkout' })).not.toBeInTheDocument();
  });

  it('requires an explicit Continue step, then shows every registration linked to the email', async () => {
    const siblings = [registration('one', 'Ada Lovelace'), registration('two', 'Grace Hopper')];
    const api = mockClient({ listParentRegistrations: vi.fn().mockResolvedValue(siblings) });
    render(<MemoryRouter initialEntries={['/manage-registration/verify#token=single-use-token&action=sign-in']}><ParentAccessPage client={api} /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Sign in to manage registrations' })).toBeInTheDocument();
    expect(api.verifyParentAccessToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and continue' }));

    expect(await screen.findByRole('heading', { name: 'Manage registrations' })).toBeInTheDocument();
    expect(api.verifyParentAccessToken).toHaveBeenCalledWith('single-use-token');
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace · E2E 15/U Ladies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grace Hopper · E2E 15/U Ladies' })).toBeInTheDocument();
    await waitFor(() => expect(api.listParentRegistrations).toHaveBeenCalled());
  });
});
