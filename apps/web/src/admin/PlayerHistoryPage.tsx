import { useState, type FormEvent } from 'react';
import type { PlayerHistoryEntryDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

export function PlayerHistoryPage({ client }: { client: Client }) {
  const [playerName, setPlayerName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [history, setHistory] = useState<PlayerHistoryEntryDTO[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setHistory(null);
    try {
      setHistory(await client.searchPlayerHistory(playerName.trim(), dateOfBirth));
    } catch {
      setError('Could not search player history. Check the details and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="player-history-page">
      <h1>Player history</h1>
      <p>Search past trial registrations by exact player name and date of birth. This finds possible matches across events; it does not merge records or create a permanent player profile.</p>
      <form onSubmit={(event) => void search(event)}>
        <p><label htmlFor="history-player-name">Player full name</label><input id="history-player-name" required minLength={2} maxLength={160} value={playerName} onChange={(event) => setPlayerName(event.target.value)} /></p>
        <p><label htmlFor="history-date-of-birth">Date of birth</label><input id="history-date-of-birth" required type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></p>
        <button type="submit" disabled={busy || playerName.trim().length < 2 || !dateOfBirth}>{busy ? 'Searching...' : 'Search history'}</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {history === null ? null : history.length === 0 ? (
        <p role="status">No matching registrations within the four-year history period.</p>
      ) : (
        <section aria-labelledby="history-results-heading">
          <h2 id="history-results-heading">Possible matching registrations</h2>
          <p role="note">Confirm these records are for the same player before relying on this history. A matching name and date of birth is not proof of identity.</p>
          <p className="scroll-region-note">Scroll horizontally to compare all trial details.</p>
          <div className="table-scroll" role="region" aria-label="Player trial history" tabIndex={0}>
            <table className="player-history-table">
              <caption>Trial records for {history[0]?.playerName}</caption>
              <thead><tr><th scope="col">Event</th><th scope="col">Association</th><th scope="col">Position choices</th><th scope="col">Attendance</th><th scope="col">Games</th><th scope="col">Courts seen</th><th scope="col">Positions played</th><th scope="col">Unique opponents</th><th scope="col">Repeat meetings</th></tr></thead>
              <tbody>{history.map((entry) => {
                const eventContext = [entry.division, entry.section].filter(Boolean).join(' ');
                const eventLabel = eventContext && entry.eventName.toLocaleLowerCase().includes(eventContext.toLocaleLowerCase())
                  ? entry.eventName
                  : [eventContext, entry.eventName].filter(Boolean).join(' — ');
                return (
                  <tr key={entry.registrationId}>
                    <th scope="row">{entry.eventDate} · {eventLabel}<br />Number {entry.number ?? 'Not assigned'}{entry.ageFlagged ? ' · review flagged' : ''}</th>
                    <td>{entry.association || '—'}</td>
                    <td>{[entry.rank1Position, entry.rank2Position, entry.rank3Position].filter(Boolean).join(', ')}</td>
                    <td>{entry.checkedIn ? 'Checked in' : entry.registrationStatus === 'PAID' ? 'No-show' : entry.registrationStatus}</td>
                    <td>{entry.games}</td>
                    <td>{entry.courtsSeen.length ? entry.courtsSeen.join(', ') : '—'}</td>
                    <td>{Object.entries(entry.positionsPlayed).map(([position, count]) => `${position}: ${count}`).join(', ') || '—'}</td>
                    <td>{entry.uniqueOpponents}</td>
                    <td>{entry.repeatOpponentMeetings}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
