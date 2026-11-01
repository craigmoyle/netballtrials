import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';

afterEach(cleanup);

const status = {
  mode: 'infisical' as const,
  infisical: { configured: true, connected: true, apiUrl: 'https://us.infisical.com', projectId: 'current-project', environment: 'prod', secretPath: '/netball-trials', updatedAt: null },
  stripe: { configured: true, updatedAt: '2026-10-30T00:00:00.000Z' },
  gmail: { configured: true, updatedAt: '2026-10-29T00:00:00.000Z' },
};

describe('SettingsPage', () => {
  it('lets Admins replace integration credentials without revealing saved values', async () => {
    const client = {
      getIntegrationSettings: vi.fn().mockResolvedValue(status),
      replaceStripeIntegration: vi.fn().mockResolvedValue(status),
      replaceGmailIntegration: vi.fn().mockResolvedValue(status),
    };
    render(<SettingsPage client={client as any} />);

    expect((await screen.findAllByText(/credentials are configured\. Last updated/i)).length).toBe(2);
    fireEvent.change(screen.getByLabelText('New Stripe secret key'), { target: { value: 'sk_test_new' } });
    fireEvent.change(screen.getByLabelText('New Stripe webhook signing secret'), { target: { value: 'whsec_new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace Stripe credentials' }));
    await waitFor(() => expect(client.replaceStripeIntegration).toHaveBeenCalledWith({ secretKey: 'sk_test_new', webhookSecret: 'whsec_new' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Stripe credentials replaced. Saved values are not shown here.');
    expect(screen.getByLabelText('New Stripe secret key')).toHaveValue('');
    expect(screen.queryByText('sk_test_new')).not.toBeInTheDocument();
  });

  it('tests and saves Infisical Cloud connection details without collecting bootstrap credentials', async () => {
    const savedStatus = { ...status, infisical: { ...status.infisical, apiUrl: 'https://eu.infisical.com', projectId: 'new-project', environment: 'test', secretPath: '/netball-trials' } };
    const client = {
      getIntegrationSettings: vi.fn().mockResolvedValue(status),
      updateInfisicalConnection: vi.fn().mockResolvedValue(savedStatus),
      replaceStripeIntegration: vi.fn(), replaceGmailIntegration: vi.fn(),
    };
    render(<SettingsPage client={client as any} />);

    expect(await screen.findByLabelText('Project ID')).toHaveValue('current-project');
    fireEvent.change(screen.getByLabelText('Infisical Cloud region'), { target: { value: 'https://eu.infisical.com' } });
    fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: 'new-project' } });
    fireEvent.change(screen.getByLabelText('Environment slug'), { target: { value: 'test' } });
    fireEvent.change(screen.getByLabelText('Secret path'), { target: { value: '/netball-trials' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection and save' }));

    await waitFor(() => expect(client.updateInfisicalConnection).toHaveBeenCalledWith({
      apiUrl: 'https://eu.infisical.com', projectId: 'new-project', environment: 'test', secretPath: '/netball-trials',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Infisical connection verified and saved/i);
    expect(screen.queryByLabelText(/Universal Auth client secret/i)).not.toBeInTheDocument();
  });

  it('shows fake-provider status without exposing credential fields in test mode', async () => {
    render(<SettingsPage client={{ getIntegrationSettings: vi.fn().mockResolvedValue({
      mode: 'fake', infisical: { configured: false, connected: false, apiUrl: null, projectId: null, environment: null, secretPath: null, updatedAt: null },
      stripe: { configured: false, updatedAt: null }, gmail: { configured: false, updatedAt: null },
    }) } as any} />);

    expect(await screen.findByText(/uses fake payment and email providers/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('New Stripe secret key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New Gmail OAuth refresh token')).not.toBeInTheDocument();
  });
});
