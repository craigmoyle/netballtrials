import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { EventDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';

export function EventsPage({ client }: { client: Client }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cloneSource, setCloneSource] = useState<EventDTO | null>(null);
  const [cloneValues, setCloneValues] = useState({ competitionYear: '', eventDate: '', registrationClosesAt: '' });

  useEffect(() => {
    let active = true;
    client
      .listEvents()
      .then((data) => {
        if (active) { setEvents(data); setError(null); }
      })
      .catch(() => {
        if (active) setError('Could not load events.');
      });
    return () => {
      active = false;
    };
  }, [client, retry]);

  function promptToClone(event: EventDTO) {
    setActionError(null);
    setCloneValues({ competitionYear: '', eventDate: '', registrationClosesAt: '' });
    setCloneSource(event);
  }

  async function clone(event: FormEvent, source: EventDTO) {
    event.preventDefault();
    setBusyId(source.id);
    setActionError(null);
    try {
      const cloned = await client.cloneEvent(source.id, {
        competitionYear: Number(cloneValues.competitionYear),
        eventDate: cloneValues.eventDate,
        registrationClosesAt: cloneValues.registrationClosesAt,
      });
      navigate(`/admin/events/${cloned.id}`);
    } catch {
      setActionError('Could not clone the event. No event was created; check the fresh date values and try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return <p role="alert">{error} <button type="button" onClick={() => { setEvents(null); setRetry((count) => count + 1); }}>Retry loading events</button></p>;
  }

  if (!events) {
    return <p>Loading events...</p>;
  }

  return (
    <section>
      <h1>Events</h1>
      <p>
        <Link className="events-new-action" to="/admin/events/new">New event</Link>
      </p>
      {actionError ? <p role="alert">{actionError}</p> : null}
      {events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <Link to={`/admin/events/${event.id}`}>{event.name}</Link>
              <p>
                {formatTrialDate(event.eventDate)} · {event.division} {event.section} · {event.courts} courts · {event.status?.toLowerCase() ?? 'draft'}
              </p>
              {cloneSource?.id === event.id ? (
                <form className="event-clone-form" onSubmit={(submitEvent) => void clone(submitEvent, event)}>
                  <p>Enter fresh values for the new DRAFT. Event format and the policy PDF will be copied.</p>
                  <p><label htmlFor="clone-competitionYear">Competition year for clone</label><input id="clone-competitionYear" type="number" min="2000" max="2100" required value={cloneValues.competitionYear} onChange={(changeEvent) => setCloneValues((current) => ({ ...current, competitionYear: changeEvent.target.value }))} /></p>
                  <p><label htmlFor="clone-eventDate">Event date for clone</label><input id="clone-eventDate" type="date" required value={cloneValues.eventDate} onChange={(changeEvent) => setCloneValues((current) => ({ ...current, eventDate: changeEvent.target.value }))} /></p>
                  <p><label htmlFor="clone-registrationClosesAt">Registration closes for clone</label><input id="clone-registrationClosesAt" type="datetime-local" required value={cloneValues.registrationClosesAt} onChange={(changeEvent) => setCloneValues((current) => ({ ...current, registrationClosesAt: changeEvent.target.value }))} /></p>
                  <p className="workflow-links"><button type="button" className="button-secondary" disabled={busyId !== null} onClick={() => setCloneSource(null)}>Cancel clone</button><button type="submit" disabled={busyId !== null}>{busyId === event.id ? 'Cloning...' : 'Create DRAFT clone'}</button></p>
                </form>
              ) : <button type="button" className="button-secondary" disabled={busyId !== null} onClick={() => promptToClone(event)}>Clone for next year</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
