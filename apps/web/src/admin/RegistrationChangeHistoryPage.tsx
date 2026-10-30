import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RegistrationChangeDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

function formatChangedAt(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne',
  }).format(new Date(value));
}

function displayValue(value: string | null): string {
  return value === null || value === '' ? '(blank)' : value;
}

export function RegistrationChangeHistoryPage({ client, eventId, registrationId }: {
  client: Client;
  eventId: string;
  registrationId: string;
}) {
  const [changes, setChanges] = useState<RegistrationChangeDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError(false);
    client.getRegistrationChanges(eventId, registrationId)
      .then((loaded) => { if (active) setChanges(loaded); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [client, eventId, registrationId, retry]);

  if (changes === null && !error) return <p role="status">Loading registration history...</p>;

  return (
    <section className="registration-change-history">
      <h1>Registration change history</h1>
      <p>Changes made to this registration by a parent or Admin.</p>
      {error ? <p role="alert">Could not load the change history. <button type="button" className="button-secondary" onClick={() => setRetry((count) => count + 1)}>Retry</button></p> : null}
      {!error && changes?.length === 0 ? <p>No recorded changes.</p> : null}
      {changes && changes.length > 0 ? (
        <div className="table-scroll" role="region" aria-label="Registration change history" tabIndex={0}>
          <table>
            <caption>Recorded registration changes</caption>
            <thead><tr><th scope="col">Changed</th><th scope="col">Actor</th><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{changes.flatMap((entry) => entry.changes.length
              ? entry.changes.map((change) => (
                <tr key={`${entry.id}-${change.field}`}>
                  <td><time dateTime={entry.createdAt}>{formatChangedAt(entry.createdAt)}</time></td>
                  <td>{entry.actorType}</td>
                  <th scope="row">{change.field}</th>
                  <td>{displayValue(change.before)}</td>
                  <td>{displayValue(change.after)}</td>
                </tr>
              ))
              : [<tr key={entry.id}>
                <td><time dateTime={entry.createdAt}>{formatChangedAt(entry.createdAt)}</time></td>
                <td>{entry.actorType}</td>
                <th scope="row">{entry.changedFields.join(', ') || 'Change'}</th>
                <td colSpan={2}>Earlier records do not include the old and new values.</td>
              </tr>])}</tbody>
          </table>
        </div>
      ) : null}
      <p><Link to={`/admin/events/${eventId}/roster`}>Back to event roster</Link></p>
    </section>
  );
}
