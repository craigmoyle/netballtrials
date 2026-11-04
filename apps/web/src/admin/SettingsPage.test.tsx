import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';

afterEach(cleanup);

const automaticEmail = {
  confirmationSubject: 'Trial registration confirmed: {{playerName}} ({{eventName}})',
  confirmationBody: '{{playerName}} is registered for {{eventName}}.\nWhen: {{eventDate}} at {{gameStartTime}}\nWhere: {{venue}}',
  reminderSubject: 'Reminder: {{eventName}}',
  reminderBody: '{{eventName}} is at {{venue}} on {{eventDate}} at {{startTime}}. See you there.',
  reminderLeadHours: 24,
  updatedAt: null,
};

const status = {
  mode: 'infisical' as const,
  infisical: { configured: true, connected: true, apiUrl: 'https://us.infisical.com', projectId: 'current-project', environment: 'prod', secretPath: '/netball-trials', updatedAt: null },
  stripe: { configured: true, updatedAt: '2026-10-30T00:00:00.000Z' },
  gmail: { configured: true, updatedAt: '2026-10-29T00:00:00.000Z' },
};

function renderSettings(client: Record<string, unknown>) {
  render(<SettingsPage client={{
    getRuntimeEnvironment: vi.fn().mockResolvedValue({ appEnv: 'production', testIntegrationsEnabled: false }),
    listStaff: vi.fn().mockResolvedValue({ admins: [], maxAdmins: null }),
    inviteStaff: vi.fn().mockResolvedValue({ status: 'sent' }),
    removeStaff: vi.fn().mockResolvedValue(null),
    ...client,
  } as any} />);
}

describe('SettingsPage', () => {
  it('shows the current Admin roster and management controls in Settings', async () => {
    const listStaff = vi.fn().mockResolvedValue({ admins: [
      { id: 'admin-1', email: 'current@example.com', createdAt: '2026-10-01T00:00:00.000Z', canRemove: false },
      { id: 'admin-2', email: 'colleague@example.com', createdAt: '2026-10-02T00:00:00.000Z', canRemove: true },
    ], maxAdmins: 5 });
    renderSettings({
      getIntegrationSettings: vi.fn().mockResolvedValue(status),
      getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail),
      listStaff,
    });

    expect(await screen.findByRole('heading', { name: 'Admin access' })).toBeInTheDocument();
    expect(await screen.findByText('2 of 5 Admin accounts in use.')).toBeInTheDocument();
    expect(screen.getByText(/Inviting a committee member creates their Admin account and sends a sign-in link/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove colleague@example.com' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove current@example.com' })).not.toBeInTheDocument();
  });

  it('edits automatic message copy and reminder lead time with a sample preview', async () => {
    const saved = vi.fn().mockImplementation(async (input) => ({ ...input, updatedAt: '2026-11-03T00:00:00.000Z' }));
    const client = {
      getIntegrationSettings: vi.fn().mockResolvedValue(status),
      getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail),
      updateAutomaticEmailSettings: saved,
    };
    renderSettings(client);

    fireEvent.change(await screen.findByLabelText('Confirmation subject'), { target: { value: 'Welcome {{playerName}} — {{eventName}}' } });
    fireEvent.change(screen.getByLabelText('Send reminder (hours before event start)'), { target: { value: '48' } });
    fireEvent.click(screen.getAllByText('Preview with sample details')[0]!.closest('summary')!);
    expect(screen.getByText(/Sample Player is registered for Sample Trials/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save automatic email settings' }));

    await waitFor(() => expect(saved).toHaveBeenCalledWith({
      confirmationSubject: 'Welcome {{playerName}} — {{eventName}}',
      confirmationBody: automaticEmail.confirmationBody,
      reminderSubject: automaticEmail.reminderSubject,
      reminderBody: automaticEmail.reminderBody,
      reminderLeadHours: 48,
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Automatic email settings saved/i);
  });

  it('shows provider status from Infisical without exposing credential fields', async () => {
    renderSettings({
      getIntegrationSettings: vi.fn().mockResolvedValue(status),
      getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail),
    });

    expect(await screen.findByText('Stripe credentials: configured. Gmail OAuth credentials: configured.')).toBeInTheDocument();
    expect(screen.getByText(/Stripe and Gmail credentials are managed in Infisical, not on this page/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/New Stripe secret key|New Gmail OAuth/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace (Stripe|Gmail) credentials/i })).not.toBeInTheDocument();
  });

  it('shows Infisical credential status without Stripe or Gmail edit controls in hosted TEST', async () => {
    const testStatus = { ...status, infisical: { ...status.infisical, environment: 'test', secretPath: '/' } };
    renderSettings({
      getIntegrationSettings: vi.fn().mockResolvedValue(testStatus),
      getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail),
      getRuntimeEnvironment: vi.fn().mockResolvedValue({ appEnv: 'testing', testAccessRequired: true, testIntegrationsEnabled: true }),
      listTestEmailOutbox: vi.fn().mockResolvedValue([]),
      clearTestEmailOutbox: vi.fn().mockResolvedValue(undefined),
    });

    expect(await screen.findByText('Stripe credentials: configured. Gmail OAuth credentials: configured.')).toBeInTheDocument();
    expect(screen.getByText(/Stripe and Gmail credentials are managed in Infisical, not on this page/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/New Stripe secret key|New Gmail OAuth/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace (Stripe|Gmail) credentials/i })).not.toBeInTheDocument();
  });

  it('tests and saves Infisical Cloud connection details without collecting bootstrap credentials', async () => {
    const savedStatus = { ...status, infisical: { ...status.infisical, apiUrl: 'https://eu.infisical.com', projectId: 'new-project', environment: 'test', secretPath: '/netball-trials' } };
    const client = {
      getIntegrationSettings: vi.fn().mockResolvedValue(status),
      getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail),
      updateInfisicalConnection: vi.fn().mockResolvedValue(savedStatus),
    };
    renderSettings(client);

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

  it('explains how to enable Infisical when the API is using deployment environment credentials', async () => {
    renderSettings({ getIntegrationSettings: vi.fn().mockResolvedValue({
      mode: 'environment', infisical: { configured: false, connected: false, apiUrl: null, projectId: null, environment: null, secretPath: null, updatedAt: null },
      stripe: { configured: false, updatedAt: null }, gmail: { configured: false, updatedAt: null },
    }), getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail) });

    expect(await screen.findByRole('heading', { name: 'Infisical secret manager' })).toBeInTheDocument();
    const infisical = screen.getByRole('region', { name: 'Infisical secret manager' });
    expect(infisical).toHaveTextContent(/not enabled for this API deployment/i);
    expect(infisical).toHaveTextContent(/INFISICAL_UNIVERSAL_AUTH_CLIENT_ID.*INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET.*INFISICAL_PROJECT_ID.*INFISICAL_ENVIRONMENT/);
    expect(screen.queryByLabelText('Project ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Universal Auth client secret/i)).not.toBeInTheDocument();
  });

  it('shows fake-provider status without exposing credential fields in test mode', async () => {
    renderSettings({ getIntegrationSettings: vi.fn().mockResolvedValue({
      mode: 'fake', infisical: { configured: false, connected: false, apiUrl: null, projectId: null, environment: null, secretPath: null, updatedAt: null },
      stripe: { configured: false, updatedAt: null }, gmail: { configured: false, updatedAt: null },
    }), getAutomaticEmailSettings: vi.fn().mockResolvedValue(automaticEmail) });

    expect(await screen.findByText(/uses fake payment and email providers/i)).toBeInTheDocument();
    expect(screen.getByText(/Infisical settings are intentionally disabled here/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('New Stripe secret key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New Gmail OAuth refresh token')).not.toBeInTheDocument();
  });
});
