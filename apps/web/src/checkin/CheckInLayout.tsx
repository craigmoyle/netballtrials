import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CheckInSummary } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function CheckInLayout({ client }: { client: Client }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<CheckInSummary | null>(null);

  useEffect(() => {
    let active = true;
    client
      .checkInSummary()
      .then((loaded) => {
        if (active) setSummary(loaded);
      })
      .catch(() => {
        if (active) navigate('/check-in', { replace: true });
      });
    return () => {
      active = false;
    };
  }, [client, navigate]);

  return (
    <header className="app-header checkin-header">
      <h1>{summary ? summary.eventName : 'Check-in'}</h1>
      {summary ? (
        <p>
          {summary.checkedIn} of {summary.registered} arrived
        </p>
      ) : null}
      <nav className="app-nav" aria-label="Check-in">
        <Link to="/check-in/scan">Scan</Link> <Link to="/check-in/lookup">Lookup</Link>
      </nav>
    </header>
  );
}
