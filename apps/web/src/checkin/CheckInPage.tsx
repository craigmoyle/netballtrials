import { useState, type FormEvent } from 'react';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function CheckInPage({ client, eventId }: { client: Client; eventId?: string }) {
  const [eventIdInput, setEventIdInput] = useState(eventId ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.openCheckIn(eventIdInput, pin);
      window.location.assign('/check-in/scan');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) setError('PIN is incorrect.');
      else if (status === 429) setError('Too many attempts. Wait a few minutes and try again.');
      else if (status === 409) setError('Check-in is closed for this event.');
      else setError('Could not start check-in. Check the event and PIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Check-in</h1>
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={onSubmit} noValidate>
        {eventId ? null : (
          <p>
            <label htmlFor="eventId">Event ID</label>
            <input
              id="eventId"
              value={eventIdInput}
              onChange={(e) => setEventIdInput(e.target.value)}
            />
          </p>
        )}
        <p>
          <label htmlFor="pin">Event PIN</label>
          <input
            id="pin"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </p>
        <button type="submit" disabled={busy}>
          {busy ? 'Starting...' : 'Start check-in'}
        </button>
      </form>
    </section>
  );
}
