import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IncompleteRegistrationDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { IncompleteRegistrationsPage } from './IncompleteRegistrationsPage';

const rows: IncompleteRegistrationDTO[] = [
  {
    id: 'verified-pending', playerName: 'Ada Lovelace', parentEmail: 'anne@example.test', status: 'PENDING',
    parentEmailVerified: true, startedAt: '2026-10-28T10:00:00.000Z', checkoutExpiresAt: '2026-10-29T10:00:00.000Z',
    followUpSentAt: null, stage: 'PAYMENT',
  },
  {
    id: 'unverified', playerName: 'Grace Hopper', parentEmail: 'unverified@example.test', status: 'PENDING',
    parentEmailVerified: false, startedAt: '2026-10-27T10:00:00.000Z', checkoutExpiresAt: '2026-10-28T10:00:00.000Z',
    followUpSentAt: null, stage: 'EMAIL_CONFIRMATION',
  },
  {
    id: 'expired', playerName: 'Katherine Johnson', parentEmail: 'expired@example.test', status: 'EXPIRED',
    parentEmailVerified: true, startedAt: '2026-10-26T10:00:00.000Z', checkoutExpiresAt: '2026-10-27T10:00:00.000Z',
    followUpSentAt: null, stage: 'PAYMENT_EXPIRED',
  },
];

describe('IncompleteRegistrationsPage', () => {
  it('distinguishes verification and payment stages and follows up only with verified parents', async () => {
    const client = {
      listIncompleteRegistrations: vi.fn().mockResolvedValue(rows),
      sendIncompleteRegistrationReminder: vi.fn().mockResolvedValue({ status: 'sent' }),
    } as unknown as Client;
    render(<IncompleteRegistrationsPage client={client} eventId="event-1" />);

    const table = await screen.findByRole('table', { name: 'Registration attempts for the last 30 days' });
    const paymentRow = within(table).getByRole('row', { name: /Ada Lovelace/ });
    const unverifiedRow = within(table).getByRole('row', { name: /Grace Hopper/ });
    const expiredRow = within(table).getByRole('row', { name: /Katherine Johnson/ });
    expect(paymentRow).toHaveTextContent('Payment pending');
    expect(unverifiedRow).toHaveTextContent('Email not confirmed');
    expect(unverifiedRow).toHaveTextContent(/no reminder sent to unverified address/i);
    expect(expiredRow).toHaveTextContent('Checkout expired');
    expect(within(table).getAllByRole('button', { name: 'Send payment reminder' })).toHaveLength(1);

    fireEvent.click(within(paymentRow).getByRole('button', { name: 'Send payment reminder' }));
    expect(client.sendIncompleteRegistrationReminder).toHaveBeenCalledWith('event-1', 'verified-pending');
    expect(await screen.findByRole('status')).toHaveTextContent('Payment reminder sent to anne@example.test.');
    expect(paymentRow).toHaveTextContent('Reminder sent');
  });

  it('shows an empty state and allows a failed report to retry', async () => {
    const listIncompleteRegistrations = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const client = { listIncompleteRegistrations, sendIncompleteRegistrationReminder: vi.fn() } as unknown as Client;
    render(<IncompleteRegistrationsPage client={client} eventId="event-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No incomplete registrations in the last 30 days.')).toBeInTheDocument();
    expect(listIncompleteRegistrations).toHaveBeenCalledTimes(2);
  });
});
