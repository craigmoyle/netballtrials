import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ApiClient as Client } from '../api/client';

export function AdminCheckInPage({ client, eventId }: { client: Client; eventId: string }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const attempt = useRef<{ client: Client; eventId: string; retry: number; request: ReturnType<Client['openAdminCheckIn']> } | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    if (!attempt.current || attempt.current.client !== client || attempt.current.eventId !== eventId || attempt.current.retry !== retry) {
      attempt.current = { client, eventId, retry, request: client.openAdminCheckIn(eventId) };
    }
    attempt.current.request
      .then(() => { if (active) navigate('/check-in/scan', { replace: true }); })
      .catch((reason: { status?: number }) => {
        if (!active) return;
        if (reason.status === 401) setError('Your Admin session has expired. Sign in again to start check-in.');
        else if (reason.status === 409) setError('Check-in is closed for this event.');
        else setError('Could not start Admin check-in. Try again or return to event controls.');
      });
    return () => { active = false; };
  }, [client, eventId, navigate, retry]);

  return error ? (
    <section>
      <h1>Admin check-in</h1>
      <p role="alert">{error}</p>
      <button type="button" onClick={() => setRetry((count) => count + 1)}>Try again</button>{' '}
      <Link to={`/admin/events/${eventId}`}>Event controls</Link>
    </section>
  ) : (
    <p role="status">Starting Admin check-in...</p>
  );
}
