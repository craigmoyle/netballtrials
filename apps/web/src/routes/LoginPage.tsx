import { useState, type FormEvent } from 'react';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function LoginPage({ client }: { client: Client }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.requestLink(email);
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section>
        <h1>Check your email</h1>
        <p>We sent a sign-in link. It expires in 15 minutes.</p>
        <button type="button" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </section>
    );
  }

  return (
    <section>
      <h1>Admin sign in</h1>
      <form onSubmit={onSubmit} noValidate>
        <p>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Sending...' : 'Send link'}
        </button>
      </form>
      <p>We will email a one-time sign-in link. It expires in 15 minutes.</p>
    </section>
  );
}
