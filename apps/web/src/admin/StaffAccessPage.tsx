import { useState, type FormEvent } from 'react';
import type { ApiClient as Client } from '../api/client';

export function StaffAccessPage({ client }: { client: Client }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.inviteStaff(email.trim());
      setEmail('');
      setMessage('Invitation sent. The recipient can use the secure sign-in link.');
    } catch {
      setError('Could not send the invitation. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Staff access</h1>
      <p>Invite a committee member to administer events. They will receive a single-use sign-in link by email.</p>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <form onSubmit={(event) => void invite(event)}>
        <p>
          <label htmlFor="staff-email">Committee member email</label>
          <input id="staff-email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
        </p>
        <button type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending invitation…' : 'Send invitation'}</button>
      </form>
    </section>
  );
}
