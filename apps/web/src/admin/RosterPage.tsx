import { useEffect, useState } from 'react';
import { POSITIONS, type Position, type RosterDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';
import { formatFee } from '../formatFee';

function saveCsv(blob: Blob, eventId: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `roster-${eventId}.csv`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PositionCounts({ title, counts }: { title: string; counts: Partial<Record<Position, number>> }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {POSITIONS.map((position) => <li key={position}>{position}: {counts[position] ?? 0}</li>)}
      </ul>
    </section>
  );
}

export function RosterPage({ client, eventId }: { client: Client; eventId: string }) {
  const [roster, setRoster] = useState<RosterDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    client.getRoster(eventId)
      .then((result) => { if (active) setRoster(result); })
      .catch(() => { if (active) setError('Could not load the roster. Check your connection and retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  async function download() {
    setDownloading(true);
    setExportError(null);
    try {
      const blob = await client.downloadRoster(eventId);
      saveCsv(blob, eventId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setExportError('The roster export period has ended under the data-retention policy.');
      } else {
        setExportError('Could not download the roster. Your browser may have blocked the download; try again.');
      }
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <p role="status">Loading roster...</p>;
  if (error) {
    return (
      <section>
        <h1>Event roster</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button>
      </section>
    );
  }
  if (!roster) return null;

  return (
    <section>
      <h1>Event roster</h1>
      <section aria-labelledby="position-counts-heading">
        <h2 id="position-counts-heading">Position choices</h2>
        <div className="position-counts">
          <PositionCounts title="First choice" counts={roster.positionCounts.rank1} />
          <PositionCounts title="Second choice" counts={roster.positionCounts.rank2} />
          <PositionCounts title="Third choice" counts={roster.positionCounts.rank3} />
          <p>Opted in to extra positions: {roster.positionCounts.extraOptIn}</p>
        </div>
      </section>
      <p><button type="button" disabled={downloading} onClick={download}>{downloading ? 'Preparing CSV...' : 'Download roster CSV'}</button></p>
      {exportError ? <p role="alert">{exportError}</p> : null}
      {roster.registrations.length === 0 ? <p>No registrations for this event.</p> : (
        <div className="table-scroll">
          <table>
            <caption>Registrations, payment status and trial-day attendance</caption>
            <thead>
              <tr><th scope="col">Player</th><th scope="col">Parent or guardian</th><th scope="col">Association</th><th scope="col">Positions</th><th scope="col">Payment</th><th scope="col">Check-in</th></tr>
            </thead>
            <tbody>
              {roster.registrations.map((registration) => {
                const amount = formatFee(registration.amountCents, registration.currency);
                const positions = [registration.rank1Position, registration.rank2Position, registration.rank3Position].filter(Boolean).join(', ');
                const attendance = registration.checkedInAt
                  ? `Number ${registration.bibNumber ?? '—'} · checked in`
                  : registration.status === 'PAID' ? 'No-show' : 'Not checked in';
                return (
                  <tr key={registration.id}>
                    <th scope="row">{registration.playerName}{registration.ageFlagged ? <span> · review flagged</span> : null}</th>
                    <td>{registration.parentName}<br /><a href={`mailto:${registration.parentEmail}`}>{registration.parentEmail}</a><br />{registration.parentMobile}</td>
                    <td>{registration.memberAssociation}</td>
                    <td>{positions}{registration.optInExtraPositions ? ' · extra positions opted in' : ''}</td>
                    <td>{registration.status}<br />{amount}</td>
                    <td>{attendance}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
