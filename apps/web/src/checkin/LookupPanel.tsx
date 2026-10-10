import { useEffect, useState } from 'react';
import type { CheckInResult, LookupResult } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { resultLabel } from './feedback';
import { notifyCheckInUpdated } from './refresh';

type Client = ReturnType<typeof apiClient>;

export function LookupPanel({ client }: { client: Client }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [undoableId, setUndoableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setError(null);
      client.lookup(query)
        .then((rows) => { if (active) setResults(rows); })
        .catch(() => { if (active) setError('Could not search registrations. Retry the lookup.'); });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, query, retry]);

  async function checkIn(id: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setUndoableId(null);
    try {
      const checked = await client.manualCheckIn(id);
      setResult(checked);
      setUndoableId(checked.result === 'refused' ? null : checked.registrationId ?? id);
      setResults((rows) => rows.map((row) => row.id === id && checked.result !== 'refused'
        ? { ...row, checkedIn: true, bibNumber: checked.bibNumber ?? row.bibNumber }
        : row));
      if (checked.result === 'checked_in') notifyCheckInUpdated();
    } catch {
      setError('Could not check in this player. The roster is unchanged; try again.');
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!undoableId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.undoCheckIn(undoableId);
      setResults((rows) => rows.map((row) => row.id === undoableId ? { ...row, checkedIn: false, bibNumber: null } : row));
      setUndoableId(null);
      setResult(null);
      notifyCheckInUpdated();
    } catch {
      setError('Could not undo this check-in. The attendance record is unchanged; try again.');
    } finally {
      setBusy(false);
    }
  }

  const label = result ? resultLabel(result) : null;

  return (
    <section>
      <h1>Manual lookup</h1>
      <p><label htmlFor="lookup">Player name</label><input id="lookup" value={query} onChange={(event) => setQuery(event.target.value)} /></p>
      {error ? <p role="alert">{error}</p> : null}
      {error && query.trim().length >= 2 ? <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry lookup</button> : null}
      {label ? <p role="status" className="scan-result" data-tone={label.tone}>{label.text}</p> : null}
      {undoableId ? <button type="button" disabled={busy} onClick={undo}>Undo last check-in</button> : null}
      <ul>
        {results.map((row) => (
          <li key={row.id}>
            {row.playerName}{row.bibNumber ? ` (bib ${row.bibNumber})` : ''}{' '}
            <button type="button" disabled={busy} onClick={() => checkIn(row.id)}>
              {busy ? 'Working...' : row.checkedIn ? 'Already in, check again' : 'Check in'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
