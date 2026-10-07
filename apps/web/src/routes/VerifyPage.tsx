import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function VerifyPage({
  client,
  onSignedIn,
}: {
  client: Client;
  onSignedIn: () => void;
}) {
  const [params] = useSearchParams();
  const [state, setState] = useState<'checking' | 'ok' | 'error'>('checking');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = params.get('token');
    if (!token) {
      setState('error');
      return;
    }

    let active = true;
    client
      .verify(token)
      .then(() => {
        if (active) {
          setState('ok');
          onSignedIn();
        }
      })
      .catch(() => {
        if (active) setState('error');
      });

    return () => {
      active = false;
    };
  }, [client, params, onSignedIn]);

  if (state === 'checking') {
    return <p>Signing you in...</p>;
  }

  if (state === 'ok') {
    return (
      <p>
        Signed in. <Link to="/admin/events">Go to events</Link>
      </p>
    );
  }

  return (
    <section>
      <h1>Link expired</h1>
      <p>This link has expired. Request a new one.</p>
      <Link to="/admin/login">Request a new link</Link>
    </section>
  );
}
