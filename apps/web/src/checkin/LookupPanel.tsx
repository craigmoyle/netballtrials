import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CheckInResult, LookupResult } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { resultLabel } from './feedback';
import { notifyCheckInUpdated } from './refresh';
import { checkInSessionEnded } from './session';

export function LookupPanel({ client }: { client: Client }) {
  const navigate = useNavigate();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [undoableId, setUndoableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      setSearching(false);
      return;
    }
    let active = true;
    setResults([]);
    setError(null);
    setSearching(true);
    const timer = setTimeout(() => {
      client.lookup(query)
        .then((rows) => {
          if (!active) return;
          setResults(rows);
          setSearching(false);
        })
        .catch((error) => {
          if (!active) return;
          if (checkInSessionEnded(error)) { navigate('/check-in', { replace: true }); return; }
          setError('Could not search registrations. Retry the lookup.');
          setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, query, retry, navigate]);

  async function checkIn(id: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setUndoableId(null);
    try {
      const checked = await client.manualCheckIn(id);
      if (!mounted.current) return;
      setResult(checked);
      setUndoableId(checked.result === 'checked_in' ? checked.registrationId ?? id : null);
      setResults((rows) => rows.map((row) => row.id === id && checked.result !== 'refused'
        ? { ...row, checkedIn: true, bibNumber: checked.bibNumber ?? row.bibNumber }
        : row));
      if (checked.result === 'checked_in') notifyCheckInUpdated();
    } catch (error) {
      if (!mounted.current) return;
      if (checkInSessionEnded(error)) navigate('/check-in', { replace: true });
      else setError('Could not check in this player. The roster is unchanged; try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function undo() {
    if (!undoableId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.undoCheckIn(undoableId);
      if (!mounted.current) return;
      setResults((rows) => rows.map((row) => row.id === undoableId ? { ...row, checkedIn: false, bibNumber: null } : row));
      setUndoableId(null);
      setResult(null);
      notifyCheckInUpdated();
    } catch (error) {
      if (!mounted.current) return;
      if (checkInSessionEnded(error)) navigate('/check-in', { replace: true });
      else setError('Could not undo this check-in. The attendance record is unchanged; try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const label = result ? resultLabel(result) : null;

  return (
    <section>
      <h1>Manual lookup</h1>
      <p><label htmlFor="lookup">Player name</label><input id="lookup" value={query} onChange={(event) => { setQuery(event.target.value); setResults([]); setError(null); }} /></p>
      {error ? <p role="alert">{error}</p> : null}
      {error && query.trim().length >= 2 ? <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry lookup</button> : null}
      {searching ? <p role="status">Searching registrations...</p> : null}
      {!searching && !error && query.trim().length >= 2 && results.length === 0 ? <p role="status">No players found matching that name.</p> : null}
      {label ? <p role="status" className="scan-result" data-tone={label.tone}>{label.text}</p> : null}
      {undoableId ? <button type="button" disabled={busy} onClick={undo}>Undo last check-in</button> : null}
      <ul className="lookup-results" aria-label="Lookup results" aria-live="polite">
        {results.map((row) => (
          <li className="lookup-result" key={row.id}>
            <div className="lookup-result-details">
              <span className="lookup-result-name">{row.playerName}</span>
              {row.bibNumber !== null ? <span className="lookup-result-number">Number {row.bibNumber}</span> : null}
              {row.checkedIn ? <span className="lookup-result-status">Already checked in</span> : null}
            </div>
            <button type="button" disabled={busy} onClick={() => checkIn(row.id)}>
              {busy ? 'Working...' : row.checkedIn ? 'Check in again' : 'Check in'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
