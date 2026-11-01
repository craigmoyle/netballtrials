import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ApiClient as Client } from '../api/client';

export function VerifyPage({
  client,
  onSignedIn,
}: {
  client: Client;
  onSignedIn: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'ok' | 'error'>('checking');
  const tokenRef = useRef<string | null>(null);
  const startedFor = useRef<string | null>(null);

  if (tokenRef.current === null) tokenRef.current = new URLSearchParams(location.hash.slice(1)).get('token');

  useEffect(() => {
    const token = tokenRef.current;
    if (!token) {
      setState('error');
      return;
    }
    if (startedFor.current === token) return;
    startedFor.current = token;
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });

    client
      .verify(token)
      .then(() => {
        setState('ok');
        onSignedIn();
      })
      .catch(() => setState('error'));
  }, [client, location.pathname, location.search, navigate, onSignedIn]);

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
