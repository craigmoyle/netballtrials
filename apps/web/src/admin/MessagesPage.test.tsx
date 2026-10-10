import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('button', { name: /refresh delivery history/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByText(/venue update — sent/i)).toBeInTheDocument();
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
