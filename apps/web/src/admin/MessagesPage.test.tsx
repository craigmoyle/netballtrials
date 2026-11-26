import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MessagesPage } from './MessagesPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const participant = (id: string, name: string, email: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id, name, email, number: null, association: 'MENA', registrationStatus: 'PAID', checkedIn: false, positions: ['GS'], eligible: true, emailVerified: true, ...extra,
});
const recipients = {
  participants: [participant('p1', 'Ada Lovelace', 'ada@example.test', { number: 7, checkedIn: true }), participant('p2', 'Grace Hopper', 'grace@example.test'), participant('pending', 'Pending Player', 'pending@example.test', { registrationStatus: 'PENDING' }), participant('unverified', 'Unverified Player', 'unverified@example.test', { registrationStatus: 'PENDING', eligible: false, emailVerified: false })],
  associations: [{ id: 'a1', name: 'MENA — Casey Contact', email: 'mena@example.test', number: null, association: 'MENA', registrationStatus: null, checkedIn: null, positions: [], eligible: true, emailVerified: null }],
};

function renderPage(overrides: Record<string, unknown> = {}) {
  const client = {
    getEvent: vi.fn().mockResolvedValue({ policyDocumentName: null }),
    getCommunicationRecipients: vi.fn().mockResolvedValue(recipients),
    listCommunicationTemplates: vi.fn().mockResolvedValue([]),
    listScheduledCommunications: vi.fn().mockResolvedValue([]),
    listCommunicationDeliveries: vi.fn().mockResolvedValue([]),
    previewCommunication: vi.fn().mockImplementation(async (_eventId: string, input: { recipientIds: string[] }) => ({
      count: input.recipientIds.length,
      recipients: recipients.participants.filter((recipient) => input.recipientIds.includes(recipient.id) && recipient.eligible),
    })),
    sendCommunication: vi.fn().mockResolvedValue({ batchId: 'batch-1', sent: 2, simulated: 0, failed: 0, ambiguous: 0, pending: 0, deliveryIds: [] }),
    scheduleCommunication: vi.fn().mockResolvedValue({ id: 'scheduled-1', eventId: 'event-1', audience: 'participants', recipientIds: ['p1'], batchId: 'scheduled-batch', subject: 'Trial update', body: 'See you soon', attachmentName: null, scheduledAt: '2027-01-15T23:30:00Z', status: 'SCHEDULED', attempts: 0, error: null, updatedAt: '2026-11-24T00:00:00Z' }),
    updateScheduledCommunication: vi.fn().mockResolvedValue({ id: 'scheduled-1', eventId: 'event-1', audience: 'participants', recipientIds: ['p1'], batchId: 'scheduled-batch', subject: 'Updated', body: 'Updated body', attachmentName: null, scheduledAt: '2027-01-15T23:30:00Z', status: 'SCHEDULED', attempts: 0, error: null, updatedAt: '2026-11-24T00:00:00Z' }),
    cancelScheduledCommunication: vi.fn().mockResolvedValue({ status: 'CANCELLED' }),
    saveCommunicationTemplate: vi.fn().mockResolvedValue({ id: 'template-1', name: 'Trial update', audience: 'participants', subject: 'Trial update', body: 'See you soon', createdAt: '', updatedAt: '' }),
    deleteCommunicationTemplate: vi.fn().mockResolvedValue(undefined),
    retryCommunication: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  render(<MemoryRouter><MessagesPage client={client as any} eventId="event-1" /></MemoryRouter>);
  return client;
}

describe('CommunicationsPage', () => {
  it('filters participants, shows the player Number, and only makes verified incomplete registrations eligible', async () => {
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/Paid · Checked in/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include Pending Player' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Include Unverified Player' })).toBeDisabled();
    expect(screen.getByText('0 selected total · 4 shown · 3 visible eligible')).toBeInTheDocument();
    expect(screen.getByText('Scroll horizontally to review all recipient details.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selectable communication recipients' })).toHaveClass('communication-recipient-list');
    fireEvent.click(screen.getByRole('button', { name: 'Select visible eligible' }));
    expect(screen.getByText('3 selected total · 4 shown · 3 visible eligible')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by payment or attendance'), { target: { value: 'PENDING' } });
    expect(screen.getByText('3 selected total · 2 shown · 1 visible eligible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear visible selection' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Filter by payment or attendance'), { target: { value: 'all' } });
    expect(screen.getByRole('checkbox', { name: 'Include Ada Lovelace' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include Grace Hopper' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Filter by association'), { target: { value: 'MENA' } });
    fireEvent.change(screen.getByLabelText('Filter by position'), { target: { value: 'GS' } });
    fireEvent.change(screen.getByLabelText('Filter by payment or attendance'), { target: { value: 'checked-in' } });
    expect(screen.getByRole('row', { name: /Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Grace Hopper/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Member associations' }));
    expect(screen.getByText('MENA — Casey Contact')).toBeInTheDocument();
    expect(screen.getByText('mena@example.test')).toBeInTheDocument();
  });

  it('previews explicit recipients before sending and uses the confirmed list', async () => {
    const client = renderPage();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Ada Lovelace' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Grace Hopper' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Trial update' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Bring water.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview recipients' }));

    expect(await screen.findByRole('heading', { name: 'Review recipients' })).toBeInTheDocument();
    expect(client.previewCommunication).toHaveBeenCalledWith('event-1', { audience: 'participants', recipientIds: ['p1', 'p2'] });
    expect(screen.getByText(/2 distinct email recipients will receive this message/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send now to 2' }));
    await waitFor(() => expect(client.sendCommunication).toHaveBeenCalledWith('event-1', expect.objectContaining({
      audience: 'participants', recipientIds: ['p1', 'p2'], subject: 'Trial update', text: 'Bring water.', batchId: expect.any(String),
    })));
    expect(await screen.findByText('2 sent, 0 simulated, 0 failed.')).toBeInTheDocument();
  });

  it('reviews both siblings but sends the selected IDs to one household email', async () => {
    const household = [
      participant('p1', 'Ada Lovelace', 'family@example.test', { number: 7 }),
      participant('p2', 'Grace Hopper', 'family@example.test', { number: 8 }),
    ];
    const client = renderPage({
      getCommunicationRecipients: vi.fn().mockResolvedValue({ participants: household, associations: [] }),
      previewCommunication: vi.fn().mockResolvedValue({ count: 1, recipients: household }),
      sendCommunication: vi.fn().mockResolvedValue({ batchId: 'batch-household', sent: 1, simulated: 0, failed: 0, ambiguous: 0, pending: 0, deliveryIds: ['delivery'] }),
    });
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Ada Lovelace' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Grace Hopper' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Household update' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Bring both players.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview recipients' }));

    expect(await screen.findByText(/1 distinct email recipient will receive/i)).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace — Number 7/i)).toBeInTheDocument();
    expect(screen.getByText(/Grace Hopper — Number 8/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send now to 1' }));
    await waitFor(() => expect(client.sendCommunication).toHaveBeenCalledWith('event-1', expect.objectContaining({
      recipientIds: ['p1', 'p2'],
    })));
  });

  it('reuses the same idempotency key when an immediate send response is lost', async () => {
    const client = renderPage({
      sendCommunication: vi.fn().mockRejectedValueOnce(new Error('network response lost'))
        .mockResolvedValue({ batchId: 'batch-1', sent: 2, simulated: 0, failed: 0, ambiguous: 0, pending: 0, deliveryIds: [] }),
    });
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Ada Lovelace' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Trial update' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Bring water.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByRole('heading', { name: 'Review recipients' });

    fireEvent.click(screen.getByRole('button', { name: 'Send now to 1' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Send now to 1' }));
    await waitFor(() => expect(client.sendCommunication).toHaveBeenCalledTimes(2));
    const first = client.sendCommunication.mock.calls[0]![1].batchId;
    const second = client.sendCommunication.mock.calls[1]![1].batchId;
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
    expect(await screen.findByText('2 sent, 0 simulated, 0 failed.')).toBeInTheDocument();
  });

  it('saves and applies audience-specific email templates', async () => {
    const template = { id: 'template-1', name: 'Trial update', audience: 'participants', subject: 'Saved subject', body: 'Saved body', createdAt: '', updatedAt: '' };
    const client = renderPage({
      listCommunicationTemplates: vi.fn().mockResolvedValue([template]),
      saveCommunicationTemplate: vi.fn().mockResolvedValue(template),
    });
    await screen.findByText('Ada Lovelace');
    fireEvent.change(screen.getByLabelText('Use a saved template'), { target: { value: 'template-1' } });
    expect(screen.getByLabelText('Subject')).toHaveValue('Saved subject');
    expect(screen.getByLabelText('Message')).toHaveValue('Saved body');
    fireEvent.change(screen.getByLabelText('Save current message as template'), { target: { value: 'Another template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(client.saveCommunicationTemplate).toHaveBeenCalledWith({ name: 'Another template', audience: 'participants', subject: 'Saved subject', body: 'Saved body' }));
    expect(await screen.findByText('Template saved.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Member associations' }));
    expect(screen.getByRole('option', { name: 'Choose a template' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Trial update' })).not.toBeInTheDocument();
  });

  it('edits a scheduled message through the existing composer and keeps its schedule id', async () => {
    const scheduled = { id: 'scheduled-1', eventId: 'event-1', audience: 'participants', recipientIds: ['p1'], batchId: 'scheduled-batch', subject: 'Original', body: 'Original body', attachmentName: 'policy.pdf', scheduledAt: '2099-01-15T23:30:00.000Z', status: 'SCHEDULED', attempts: 0, error: null, updatedAt: '2026-11-24T00:00:00Z' };
    const client = renderPage({ listScheduledCommunications: vi.fn().mockResolvedValue([scheduled]) });
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('button', { name: 'Edit scheduled email' }));
    expect(screen.getByLabelText('Subject')).toHaveValue('Original');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Updated' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Updated body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByRole('heading', { name: 'Review recipients' });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule changes' }));
    await waitFor(() => expect(client.updateScheduledCommunication).toHaveBeenCalledWith('event-1', 'scheduled-1', expect.objectContaining({ subject: 'Updated', text: 'Updated body', expectedUpdatedAt: '2026-11-24T00:00:00Z' })));
  });

  it('schedules a reviewed message and offers cancellation before it sends', async () => {
    const client = renderPage();
    await screen.findByText('Ada Lovelace');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Ada Lovelace' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Reminder' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Tomorrow.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview recipients' }));
    await screen.findByRole('heading', { name: 'Review recipients' });
    fireEvent.change(screen.getByLabelText('Send at (Australia/Melbourne)'), { target: { value: '2099-01-15T10:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule email' }));
    await waitFor(() => expect(client.scheduleCommunication).toHaveBeenCalledWith('event-1', expect.objectContaining({ audience: 'participants', recipientIds: ['p1'], subject: 'Reminder', text: 'Tomorrow.', scheduledLocal: '2099-01-15T10:30', batchId: expect.any(String) })));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel scheduled email' }));
    await waitFor(() => expect(client.cancelScheduledCommunication).toHaveBeenCalledWith('event-1', 'scheduled-1'));
  });
});
