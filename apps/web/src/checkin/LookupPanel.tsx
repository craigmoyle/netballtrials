import { useEffect, useState } from 'react';
import type { CheckInResult, LookupResult } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { resultLabel } from './feedback';

type Client = ReturnType<typeof apiClient>;

export function LookupPanel({ client }: { client: Client }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [lastCheckedIn, setLastCheckedIn] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      client
        .lookup(query)
        .then((rows) => {
          if (active) setResults(rows);
        })
        .catch(() => {
          if (active) setResults([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, query]);

  async function checkIn(id: string) {
    const checked = await client.manualCheckIn(id);
    setResult(checked);
    setLastCheckedIn(checked.result === 'checked_in' ? id : null);
  }

  async function undo() {
    if (!lastCheckedIn) return;
    await client.undoCheckIn(lastCheckedIn);
    setLastCheckedIn(null);
    setResult(null);
    setResults((rows) => rows.map((row) => (row.id === lastCheckedIn ? { ...row, checkedIn: false } : row)));
  }

  const label = result ? resultLabel(result) : null;

  return (
    <section>
      <h1>Manual lookup</h1>
      <p>
        <label htmlFor="lookup">Player name</label>
        <input id="lookup" value={query} onChange={(e) => setQuery(e.target.value)} />
      </p>
      {label ? <p role="status">{label.text}</p> : null}
      {lastCheckedIn ? (
        <button type="button" onClick={undo}>
          Undo last check-in
        </button>
      ) : null}
      <ul>
        {results.map((row) => (
          <li key={row.id}>
            {row.playerName}
            {row.bibNumber ? ` (bib ${row.bibNumber})` : ''}{' '}
            <button type="button" onClick={() => checkIn(row.id)}>
              {row.checkedIn ? 'Already in, check again' : 'Check in'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
