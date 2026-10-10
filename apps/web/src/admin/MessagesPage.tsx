import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EmailLogDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;
type DeliveryResult = { sent: number; failed: number; ambiguous: number; pending: number };

function deliveryText(result: DeliveryResult): string {
  const parts = [`${result.sent} sent`, `${result.failed} failed`];
  if (result.ambiguous) parts.push(`${result.ambiguous} outcome unknown`);
  if (result.pending) parts.push(`${result.pending} still pending`);
  return parts.join(', ');
}

export function MessagesPage({ client, eventId }: { client: Client; eventId: string }) {
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [log, setLog] = useState<EmailLogDTO[]>([]);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [historyBatchId, setHistoryBatchId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [ambiguousIds, setAmbiguousIds] = useState<string[]>([]);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshLog(currentBatch?: string): Promise<boolean> {
    try {
      const entries = await client.listEmailLog(eventId);
      setError(null);
      setLog(entries);
      if (currentBatch) {
        const deliveries = entries.filter((entry) => entry.batchId === currentBatch);
        const failed = deliveries.filter((entry) => entry.status === 'FAILED');
        const ambiguous = deliveries.filter((entry) => entry.status === 'AMBIGUOUS');
        const pending = deliveries.filter((entry) => entry.status === 'PENDING' || entry.status === 'SENDING');
        const sent = deliveries.filter((entry) => entry.status === 'SENT');
        setFailedIds(failed.map((entry) => entry.id));
        setAmbiguousIds(ambiguous.map((entry) => entry.id));
        setResult({ sent: sent.length, failed: failed.length, ambiguous: ambiguous.length, pending: pending.length });
        if (deliveries.length > 0 && sent.length > 0 && failed.length === 0 && ambiguous.length === 0 && pending.length === 0) finishBatch();
      }
      return true;
    } catch {
      setError('The delivery result is known, but the delivery history could not be refreshed. Try refreshing it.');
      return false;
    }
  }

  useEffect(() => {
    let active = true;
    client.listEmailLog(eventId)
      .then((entries) => { if (active) setLog(entries); })
      .catch(() => { if (active) setError('Could not load recent delivery history.'); });
    return () => { active = false; };
  }, [client, eventId]);

  async function reviewRecipients() {
    setResult(null);
    setHistoryBatchId(null);
    setBusy(true);
    setError(null);
    try {
      const preview = await client.getMessageRecipientCount(eventId);
      setRecipientCount(preview.count);
      setConfirming(true);
    } catch {
      setError('Could not count eligible recipients. Your draft is still here; try again.');
    } finally {
      setBusy(false);
    }
  }

  function finishBatch() {
    setSubject('');
    setText('');
    setBatchId(null);
    setFailedIds([]);
    setAmbiguousIds([]);
    setRecipientCount(null);
    setConfirming(false);
  }

  async function send() {
    const currentBatch = batchId ?? crypto.randomUUID();
    setBatchId(currentBatch);
    setBusy(true);
    setError(null);
    try {
      const summary = await client.sendMessage(eventId, { subject, text, batchId: currentBatch });
      setBatchId(summary.batchId);
      setHistoryBatchId(summary.batchId);
      const deliveryResult = {
        sent: summary.sent,
        failed: summary.failed,
        ambiguous: summary.ambiguous,
        pending: summary.pending,
      };
      setResult(deliveryResult);
      setConfirming(false);
      const refreshed = await refreshLog(summary.batchId);
      if (deliveryResult.failed === 0 && deliveryResult.ambiguous === 0 && deliveryResult.pending === 0) {
        finishBatch();
        if (!refreshed) setError('The message was sent, but the delivery history could not be refreshed.');
      }
    } catch {
      setConfirming(false);
      setError('We could not confirm the batch result. Do not start a new batch; retry this same message batch to check safely.');
    } finally {
      setBusy(false);
    }
  }

  async function retry(deliveryIds: string[], includeAmbiguous = false) {
    if (!batchId || deliveryIds.length === 0) return;
    if (includeAmbiguous && !window.confirm('Gmail may already have accepted these messages. Retrying can send duplicates. Continue?')) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await client.retryMessage(eventId, batchId, deliveryIds, includeAmbiguous);
      setHistoryBatchId(batchId);
      const deliveryResult = {
        sent: summary.sent,
        failed: summary.failed,
        ambiguous: summary.ambiguous,
        pending: summary.pending,
      };
      setResult(deliveryResult);
      const refreshed = await refreshLog(batchId);
      if (deliveryResult.failed === 0 && deliveryResult.ambiguous === 0 && deliveryResult.pending === 0) {
        finishBatch();
        if (!refreshed) setError('The message was sent, but the delivery history could not be refreshed.');
      }
    } catch {
      setError('Could not retry these recipients. Your draft and delivery records are still available.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Message registrants</h1>
      <nav aria-label="Event workflows" className="workflow-links">
        <Link to={`/admin/events/${eventId}`}>Event controls</Link>
        <Link to={`/admin/events/${eventId}/roster`}>Roster and export</Link>
        <Link to={`/admin/events/${eventId}/review`}>Review queue</Link>
        <Link to={`/admin/events/${eventId}/plan`}>Plan rounds</Link>
        <Link to={`/admin/events/${eventId}/sheets`}>Print selector sheets</Link>
      </nav>
      {error ? <p role="alert">{error}</p> : null}
      <form
        onSubmit={(submitEvent) => { submitEvent.preventDefault(); void reviewRecipients(); }}
        noValidate
      >
        <p>
          <label htmlFor="subject">Subject</label>
          <input id="subject" maxLength={200} value={subject} disabled={busy || confirming || Boolean(batchId)} onChange={(event) => setSubject(event.target.value)} />
        </p>
        <p>
          <label htmlFor="body">Message</label>
          <textarea id="body" maxLength={5000} value={text} disabled={busy || confirming || Boolean(batchId)} onChange={(event) => setText(event.target.value)} />
        </p>
        <button type="submit" disabled={busy || subject.trim().length === 0 || text.trim().length === 0 || confirming || Boolean(batchId)}>
          {busy ? 'Counting recipients...' : 'Review recipients'}
        </button>
      </form>
      {confirming ? (
        <section aria-labelledby="message-confirm-title" className="message-confirmation">
          <h2 id="message-confirm-title">Confirm event message</h2>
          <p>The server found {recipientCount} distinct paid parent email address{recipientCount === 1 ? '' : 'es'}. Eligibility is checked again when sending.</p>
          <p><strong>{subject}</strong></p>
          <p>{text}</p>
          <button type="button" disabled={busy || recipientCount === 0} onClick={send}>
            {busy ? 'Sending...' : `Send to ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`}
          </button>
          <button type="button" disabled={busy} onClick={() => { setConfirming(false); setRecipientCount(null); }}>Cancel</button>
        </section>
      ) : null}
      {result ? <p role="status">{deliveryText(result)}</p> : null}
      {batchId && result === null && !confirming ? (
        <p><button type="button" disabled={busy} onClick={send}>Retry same message batch</button></p>
      ) : null}
      {batchId && (failedIds.length > 0 || ambiguousIds.length > 0) ? (
        <p>
          {failedIds.length > 0 ? (
            <button type="button" disabled={busy} onClick={() => retry(failedIds)}>
              Retry failed deliveries ({failedIds.length})
            </button>
          ) : null}{' '}
          {ambiguousIds.length > 0 ? (
            <button type="button" disabled={busy} onClick={() => retry(ambiguousIds, true)}>
              Retry ambiguous deliveries ({ambiguousIds.length})
            </button>
          ) : null}
        </p>
      ) : null}
      {historyBatchId && (error || result?.pending) ? (
        <p><button type="button" disabled={busy} onClick={() => refreshLog(historyBatchId)}>{error ? 'Refresh delivery history' : 'Check delivery status'}</button></p>
      ) : null}
      <h2>Recent deliveries</h2>
      {log.length === 0 ? <p>No messages sent for this event yet.</p> : (
        <ul>
          {log.map((entry) => (
            <li key={entry.id}>
              {entry.status === 'ANONYMIZED' ? 'Message details removed under retention policy' : entry.subject || '(no subject)'} — {entry.status === 'FAILED' ? `failed: ${entry.error ?? 'delivery rejected'}` : entry.status === 'AMBIGUOUS' ? `outcome unknown: ${entry.error ?? 'provider may have accepted the message'}` : entry.status.toLowerCase()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
