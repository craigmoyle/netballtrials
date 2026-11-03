import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestEmailOutboxPanel } from './TestEmailOutboxPanel';

afterEach(cleanup);

describe('TestEmailOutboxPanel', () => {
  it('shows simulated messages, only links same-origin verification URLs, and clears the outbox', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const client = {
      listTestEmailOutbox: vi.fn().mockResolvedValue([{
        id: 'mail-1', to: 'nicole@example.test', subject: 'Your Admin sign-in link',
        body: `Sign in: ${window.location.origin}/admin/verify#token=short-lived\nIgnore https://attacker.example/`,
        createdAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-05T00:00:00.000Z',
      }]),
      clearTestEmailOutbox: vi.fn().mockResolvedValue(undefined),
    };
    render(<TestEmailOutboxPanel client={client as any} />);

    expect(await screen.findByText(/Messages to non-Admin addresses are simulated here; allowlisted Admins receive real email from the TEST mailbox/i)).toBeInTheDocument();
    expect(await screen.findByText(/Your Admin sign-in link — nicole@example.test/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'https://attacker.example/' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy test email link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/admin/verify#token=short-lived`));
    expect(await screen.findByText('Test email link copied. Share it directly with the intended recipient.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear simulated outbox' }));
    await waitFor(() => expect(client.clearTestEmailOutbox).toHaveBeenCalledOnce());
    expect(await screen.findByText('No simulated messages.')).toBeInTheDocument();
  });
});
