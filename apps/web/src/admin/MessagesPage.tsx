import { useEffect, useState } from 'react';
import type { EmailLogDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function MessagesPage({ client, eventId }: { client: Client; eventId: string }) {
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [log, setLog] = useState<EmailLogDTO[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .listEmailLog(eventId)
      .then((entries) => {
        if (active) setLog(entries);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, eventId]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await client.sendMessage(eventId, { subject, text });
      setLog(await client.listEmailLog(eventId));
      setSubject('');
      setText('');
      setConfirming(false);
    } catch {
      setError('Could not send the message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Message registrants</h1>
      {error ? <p role="alert">{error}</p> : null}
      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          setConfirming(true);
        }}
        noValidate
      >
        <p>
          <label htmlFor="subject">Subject</label>
          <input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </p>
        <p>
          <label htmlFor="body">Message</label>
          <textarea id="body" value={text} onChange={(e) => setText(e.target.value)} />
        </p>
        <button type="submit" disabled={subject.length === 0 || text.length === 0}>
          Review recipients
        </button>
      </form>
      {confirming ? (
        <div role="alert">
          <p>This email goes to every paid registrant for this event.</p>
          <button type="button" disabled={busy} onClick={send}>
            {busy ? 'Sending...' : 'Send now'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      <h2>Recent deliveries</h2>
      <ul>
        {log.map((entry) => (
          <li key={entry.id}>
            {entry.subject} — {entry.failedAt ? `failed: ${entry.error ?? 'unknown'}` : 'sent'}
          </li>
        ))}
      </ul>
    </section>
  );
}
