import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MessagesPage } from './MessagesPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const participant = (id: string, name: string, email: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id, name, email, number: null, association: 'MENA', registrationStatus: 'PAID', checkedIn: false, positions: ['GS'], ...extra,
});
const recipients = {
  participants: [participant('p1', 'Ada Lovelace', 'ada@example.test', { number: 7, checkedIn: true }), participant('p2', 'Grace Hopper', 'grace@example.test'), participant('pending', 'Pending Player', 'pending@example.test', { registrationStatus: 'PENDING' })],
  associations: [{ id: 'a1', name: 'MENA — Casey Contact', email: 'mena@example.test', number: null, association: 'MENA', registrationStatus: null, checkedIn: null, positions: [] }],
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
      recipients: recipients.participants.filter((recipient) => input.recipientIds.includes(recipient.id) && recipient.registrationStatus === 'PAID'),
    })),
    sendCommunication: vi.fn().mockResolvedValue({ batchId: 'batch-1', sent: 2, failed: 0, ambiguous: 0, pending: 0, deliveryIds: [] }),
    scheduleCommunication: vi.fn().mockResolvedValue({ id: 'scheduled-1', eventId: 'event-1', audience: 'participants', recipientIds: ['p1'], batchId: 'scheduled-batch', subject: 'Trial update', body: 'See you soon', scheduledAt: '2027-01-15T23:30:00Z', status: 'SCHEDULED', attempts: 0, error: null }),
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
  it('filters participants, shows the player Number, and excludes pending registrations from selection', async () => {
    renderPage();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/Paid · Checked in/i)).toBeInTheDocument();
    const pending = screen.getByRole('checkbox', { name: 'Include Pending Player' });
    expect(pending).toBeDisabled();
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
    expect(await screen.findByRole('status')).toHaveTextContent('2 sent, 0 failed');
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
    expect(await screen.findByRole('status')).toHaveTextContent('Template saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Member associations' }));
    expect(screen.getByRole('option', { name: 'Choose a template' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Trial update' })).not.toBeInTheDocument();
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
    await waitFor(() => expect(client.scheduleCommunication).toHaveBeenCalledWith('event-1', expect.objectContaining({ audience: 'participants', recipientIds: ['p1'], subject: 'Reminder', text: 'Tomorrow.', scheduledLocal: '2099-01-15T10:30' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel scheduled email' }));
    await waitFor(() => expect(client.cancelScheduledCommunication).toHaveBeenCalledWith('event-1', 'scheduled-1'));
  });
});
