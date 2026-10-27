import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MessagesPage } from './MessagesPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const BATCH_1 = '11111111-1111-4111-8111-111111111111';
const BATCH_2 = '22222222-2222-4222-8222-222222222222';
const BATCH_3 = '33333333-3333-4333-8333-333333333333';
const BATCH_4 = '44444444-4444-4444-8444-444444444444';
const BATCH_AMBIGUOUS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BATCH_PENDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fillDraft() {
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Venue update' } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Trials are at SNC.' } });
}

function renderPage(client: Record<string, unknown>) {
  return render(<MemoryRouter><MessagesPage client={client as any} eventId="event-1" /></MemoryRouter>);
}

const failedDelivery = {
  id: 'delivery-failed', batchId: BATCH_1, to: 'retry@example.com', subject: 'Venue update', body: 'Trials are at SNC.',
  kind: 'message', status: 'FAILED', attempts: 1, senderUserId: 'admin-1', registrationId: 'reg-1',
  createdAt: '2026-10-10T00:00:00.000Z', lastAttemptAt: null, sentAt: null, failedAt: null, error: 'provider_rejected_403',
};
const sentDelivery = { ...failedDelivery, id: 'delivery-sent', to: 'ok@example.com', status: 'SENT' };

describe('MessagesPage', () => {
  it('shows the exact distinct-recipient count before sending', async () => {
    const client = {
      listEmailLog: vi.fn().mockResolvedValue([]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 3 }),
      sendMessage: vi.fn(),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    expect(await screen.findByText(/3 distinct paid parent email addresses/i)).toBeInTheDocument();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('loads slow initial history even after reviewing recipients and canceling', async () => {
    let resolveHistory!: (entries: typeof sentDelivery[]) => void;
    const history = new Promise<typeof sentDelivery[]>((resolve) => { resolveHistory = resolve; });
    const client = {
      listEmailLog: vi.fn(() => history),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn(),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Review recipients' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => { resolveHistory([{ ...sentDelivery, subject: 'Previous announcement' }]); });

    expect(screen.getByText('Previous announcement — sent')).toBeInTheDocument();
    expect(screen.queryByText('No messages sent for this event yet.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('Venue update');
    expect(screen.getByLabelText('Message')).toHaveValue('Trials are at SNC.');
    expect(client.listEmailLog).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('does not let slow initial history replace a newer batch reconciliation', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_1);
    let resolveHistory!: (entries: typeof sentDelivery[]) => void;
    const history = new Promise<typeof sentDelivery[]>((resolve) => { resolveHistory = resolve; });
    const client = {
      listEmailLog: vi.fn().mockReturnValueOnce(history).mockResolvedValueOnce([failedDelivery]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn().mockResolvedValue({ batchId: BATCH_1, sent: 0, failed: 1, ambiguous: 0, pending: 0 }),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Review recipients' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send to 1 recipient' }));
    await screen.findByRole('button', { name: /retry failed deliveries/i });
    await act(async () => { resolveHistory([{ ...sentDelivery, subject: 'Previous announcement' }]); });

    expect(screen.queryByText('Previous announcement — sent')).not.toBeInTheDocument();
    expect(screen.getByText(/Venue update — failed/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 sent, 1 failed');
    expect(screen.getByLabelText('Subject')).toHaveValue('Venue update');
  });

  it('reports partial delivery, preserves the draft and retries only known failed recipients', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_1);
    const client = {
      listEmailLog: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([failedDelivery, sentDelivery])
        .mockResolvedValueOnce([{ ...failedDelivery, status: 'SENT', error: null, sentAt: '2026-10-10T00:05:00.000Z' }, sentDelivery]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 2 }),
      sendMessage: vi.fn().mockResolvedValue({ batchId: BATCH_1, sent: 1, failed: 1, ambiguous: 0, pending: 0, deliveryIds: ['delivery-sent', 'delivery-failed'], sentThisRun: 1, failedThisRun: 1, ambiguousThisRun: 0 }),
      retryMessage: vi.fn().mockResolvedValue({ batchId: BATCH_1, sent: 2, failed: 0, ambiguous: 0, pending: 0, deliveryIds: ['delivery-sent', 'delivery-failed'] }),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 2 recipients/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent, 1 failed');
    expect(screen.getByLabelText('Subject')).toHaveValue('Venue update');
    expect(screen.getByLabelText('Message')).toHaveValue('Trials are at SNC.');
    fireEvent.click(screen.getByRole('button', { name: /retry failed deliveries/i }));
    await waitFor(() => expect(client.retryMessage).toHaveBeenCalledWith('event-1', BATCH_1, ['delivery-failed'], false));
    expect(await screen.findByRole('status')).toHaveTextContent('2 sent, 0 failed');
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('shows audited delivery details and can retry a failed historical delivery after reload', async () => {
    const client = {
      listEmailLog: vi.fn()
        .mockResolvedValueOnce([failedDelivery])
        .mockResolvedValueOnce([{ ...failedDelivery, status: 'SENT', sentAt: '2026-10-10T00:05:00.000Z', error: null }]),
      getMessageRecipientCount: vi.fn(),
      sendMessage: vi.fn(),
      retryMessage: vi.fn().mockResolvedValue({ batchId: BATCH_1, sent: 1, failed: 0, ambiguous: 0, pending: 0, deliveryIds: ['delivery-failed'] }),
    };
    renderPage(client);
    expect(await screen.findByText(/venue update — failed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delivery details'));
    expect(screen.getByText('Recipient: retry@example.com')).toBeInTheDocument();
    expect(screen.getByText('Sender ID: admin-1')).toBeInTheDocument();
    expect(screen.getByText('Trials are at SNC.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry this delivery' }));
    await waitFor(() => expect(client.retryMessage).toHaveBeenCalledWith('event-1', BATCH_1, ['delivery-failed'], false));
    expect(await screen.findByText(/venue update — sent/i)).toBeInTheDocument();
  });

  it('preserves the draft after total failure', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_2);
    const client = {
      listEmailLog: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...failedDelivery, batchId: BATCH_2 }]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn().mockResolvedValue({ batchId: BATCH_2, sent: 0, failed: 1, ambiguous: 0, pending: 0, deliveryIds: ['delivery-failed'], sentThisRun: 0, failedThisRun: 1, ambiguousThisRun: 0 }),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 1 recipient/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('0 sent, 1 failed');
    expect(screen.getByLabelText('Subject')).toHaveValue('Venue update');
    expect(screen.getByLabelText('Message')).toHaveValue('Trials are at SNC.');
  });

  it('reports successful delivery even if refreshing the delivery history fails', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_3);
    const client = {
      listEmailLog: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed')).mockResolvedValueOnce([{ ...sentDelivery, batchId: BATCH_3 }]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn().mockResolvedValue({ batchId: BATCH_3, sent: 1, failed: 0, ambiguous: 0, pending: 0, deliveryIds: ['delivery-sent'], sentThisRun: 1, failedThisRun: 0, ambiguousThisRun: 0 }),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 1 recipient/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent, 0 failed');
    expect(await screen.findByRole('alert')).toHaveTextContent(/delivery history could not be refreshed/i);
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'New draft B' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep these details' } });
    fireEvent.click(screen.getByRole('button', { name: /refresh delivery history/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText(/venue update — sent/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toHaveValue('New draft B');
    expect(screen.getByLabelText('Message')).toHaveValue('Keep these details');
  });

  it.each(['new batch', 'new event'])('ignores a delayed old history refresh after starting a %s', async (supersededBy) => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(BATCH_1).mockReturnValueOnce(BATCH_2);
    let resolveHistory!: (entries: unknown[]) => void;
    const client = {
      listEmailLog: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))
        .mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve; }))
        .mockResolvedValue([{ ...failedDelivery, batchId: BATCH_2 }]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn().mockResolvedValueOnce({ batchId: BATCH_1, sent: 1, failed: 0, ambiguous: 0, pending: 0 })
        .mockResolvedValueOnce({ batchId: BATCH_2, sent: 0, failed: 1, ambiguous: 0, pending: 0 }),
    };
    const page = renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 1 recipient/i }));
    fireEvent.click(await screen.findByRole('button', { name: /refresh delivery history/i }));
    if (supersededBy === 'new event') {
      page.rerender(<MemoryRouter><MessagesPage client={client as any} eventId="event-2" /></MemoryRouter>);
      await waitFor(() => expect(client.listEmailLog).toHaveBeenCalledWith('event-2'));
    }
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'New batch B' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep B' } });
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 1 recipient/i }));
    await screen.findByRole('button', { name: /retry failed deliveries/i });
    await act(async () => resolveHistory([sentDelivery]));
    expect(screen.getByLabelText('Subject')).toHaveValue('New batch B');
    expect(screen.getByLabelText('Message')).toHaveValue('Keep B');
    expect(screen.getByRole('button', { name: /retry failed deliveries/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 sent, 1 failed');
  });

  it('requires explicit confirmation before retrying an ambiguous delivery', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const ambiguousDelivery = { ...failedDelivery, id: 'delivery-ambiguous', batchId: BATCH_AMBIGUOUS, status: 'AMBIGUOUS', error: 'delivery_outcome_unknown' };
    const client = {
      listEmailLog: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([ambiguousDelivery]).mockResolvedValueOnce([{ ...ambiguousDelivery, status: 'SENT' }]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn().mockResolvedValue({ batchId: BATCH_AMBIGUOUS, sent: 0, failed: 0, ambiguous: 1, pending: 0, deliveryIds: ['delivery-ambiguous'], sentThisRun: 0, failedThisRun: 0, ambiguousThisRun: 1 }),
      retryMessage: vi.fn().mockResolvedValue({ batchId: BATCH_AMBIGUOUS, sent: 1, failed: 0, ambiguous: 0, pending: 0, deliveryIds: ['delivery-ambiguous'] }),
    };
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_AMBIGUOUS);
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 1 recipient/i }));
    expect(await screen.findByText(/outcome unknown: delivery_outcome_unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed: delivery_outcome_unknown/i)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /retry ambiguous deliveries/i }));
    expect(confirm).toHaveBeenCalled();
    expect(client.retryMessage).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /retry ambiguous deliveries/i }));
    await waitFor(() => expect(client.retryMessage).toHaveBeenCalledWith('event-1', BATCH_AMBIGUOUS, ['delivery-ambiguous'], true));
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent, 0 failed');
  });

  it('lets an administrator recheck a still-pending batch without starting a new one', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_PENDING);
    const client = {
      listEmailLog: vi.fn().mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...failedDelivery, batchId: BATCH_PENDING, status: 'SENDING' }])
        .mockResolvedValueOnce([{ ...sentDelivery, batchId: BATCH_PENDING }]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage: vi.fn().mockResolvedValue({ batchId: BATCH_PENDING, sent: 0, failed: 0, ambiguous: 0, pending: 1, deliveryIds: ['delivery-sent'], sentThisRun: 0, failedThisRun: 0, ambiguousThisRun: 0 }),
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send to 1 recipient/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 still pending');
    fireEvent.click(screen.getByRole('button', { name: /check delivery status/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent, 0 failed');
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Subject')).toHaveValue('');
  });

  it('prevents a duplicate send while the first request is pending', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(BATCH_4);
    let resolveSend!: (value: unknown) => void;
    const sendMessage = vi.fn(() => new Promise((resolve) => { resolveSend = resolve; }));
    const client = {
      listEmailLog: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...sentDelivery, batchId: BATCH_4 }]),
      getMessageRecipientCount: vi.fn().mockResolvedValue({ count: 1 }),
      sendMessage,
    };
    renderPage(client);
    fillDraft();
    fireEvent.click(screen.getByRole('button', { name: /review recipients/i }));
    const send = await screen.findByRole('button', { name: /send to 1 recipient/i });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    resolveSend({ batchId: BATCH_4, sent: 1, failed: 0, ambiguous: 0, pending: 0, deliveryIds: [], sentThisRun: 1, failedThisRun: 0, ambiguousThisRun: 0 });
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent, 0 failed');
  });
});
