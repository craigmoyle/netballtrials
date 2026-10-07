import { useEffect, useState } from 'react';
import type { CheckInSummary } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function CheckInLayout({ client }: { client: Client }) {
  const [summary, setSummary] = useState<CheckInSummary | null>(null);

  useEffect(() => {
    let active = true;
    client
      .checkInSummary()
      .then((loaded) => {
        if (active) setSummary(loaded);
      })
      .catch(() => {
        if (active) window.location.assign('/check-in');
      });
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <header>
      <h1>{summary ? summary.eventName : 'Check-in'}</h1>
      {summary ? (
        <p>
          {summary.checkedIn} of {summary.registered} arrived
        </p>
      ) : null}
      <nav>
        <a href="/check-in/scan">Scan</a> <a href="/check-in/lookup">Lookup</a>
      </nav>
    </header>
  );
}
