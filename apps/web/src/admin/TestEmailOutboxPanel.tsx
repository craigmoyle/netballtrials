import { useEffect, useState } from 'react';
import type { TestEmailOutboxDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

function sameOriginLinks(text: string): string[] {
  const links = [...text.matchAll(/https?:\/\/[^\s<>]+/g)]
    .map(([url]) => url.replace(/[.,;)]*$/, ''));
  return [...new Set(links.filter((url) => {
    try { return new URL(url).origin === window.location.origin; }
    catch { return false; }
  }))];
}

export function TestEmailOutboxPanel({ client }: { client: Client }) {
  const [messages, setMessages] = useState<TestEmailOutboxDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try { setMessages(await client.listTestEmailOutbox()); }
    catch { setError('Could not load simulated messages. Try again.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [client]);

  async function copyLink(url: string) {
    setError(null);
    setNotice(null);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Test email link copied. Share it directly with the intended recipient.');
    } catch { setError('Could not copy the link. Select it from the message above and copy it manually.'); }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.clearTestEmailOutbox();
      setMessages([]);
    } catch { setError('Could not clear the simulated outbox. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="site-settings-section test-email-outbox" aria-labelledby="test-email-outbox-heading">
      <h2 id="test-email-outbox-heading">Simulated email outbox</h2>
      <p>Messages to non-Admin addresses are simulated here; allowlisted Admins receive real email from the TEST mailbox. Links keep their normal expiry; outbox entries expire after 24 hours.</p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {loading ? <p role="status">Loading simulated messages…</p> : messages.length === 0 ? <p>No simulated messages.</p> : (
        <>
          <ul>{messages.map((message) => {
            const links = sameOriginLinks(message.body);
            return (
              <li key={message.id}>
                <details>
                  <summary>{message.subject} — {message.to} — {new Date(message.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', timeZoneName: 'short' })}</summary>
                  <pre>{message.body}</pre>
                  {links.length > 0 ? <ul aria-label="Links in simulated email">{links.map((url) => <li key={url}><button type="button" className="button-secondary" onClick={() => void copyLink(url)}>Copy test email link</button></li>)}</ul> : null}
                </details>
              </li>
            );
          })}</ul>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void clear()}>{busy ? 'Clearing…' : 'Clear simulated outbox'}</button>
        </>
      )}
      {!loading && error ? <button type="button" className="button-secondary" disabled={busy} onClick={() => void load()}>Retry</button> : null}
    </section>
  );
}
