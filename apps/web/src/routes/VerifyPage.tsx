import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ApiClient as Client } from '../api/client';

export function VerifyPage({
  client,
  onSignedIn,
}: {
  client: Client;
  onSignedIn: () => void;
}) {
  const [params] = useSearchParams();
  const [state, setState] = useState<'checking' | 'ok' | 'error'>('checking');
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('error');
      return;
    }
    if (startedFor.current === token) return;
    startedFor.current = token;

    client
      .verify(token)
      .then(() => {
        setState('ok');
        onSignedIn();
      })
      .catch(() => setState('error'));
  }, [client, onSignedIn, params]);

  if (state === 'checking') return <p role="status">Signing you in...</p>;
  if (state === 'ok') {
    return <p>Signed in. <Link to="/admin/events">Go to events</Link></p>;
  }

  return (
    <section>
      <h1>Link expired</h1>
      <p>This link has expired. Request a new one.</p>
      <Link to="/admin/login">Request a new link</Link>
    </section>
  );
}
