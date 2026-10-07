import { useEffect, useState } from 'react';
import type { EventDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function EventsPage({ client }: { client: Client }) {
  const [events, setEvents] = useState<EventDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .listEvents()
      .then((data) => {
        if (active) setEvents(data);
      })
      .catch(() => {
        if (active) setError('Could not load events.');
      });
    return () => {
      active = false;
    };
  }, [client]);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!events) {
    return <p>Loading events...</p>;
  }

  return (
    <section>
      <h1>Events</h1>
      <p>
        <a href="/admin/events/new">New event</a>
      </p>
      {events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <a href={`/admin/events/${event.id}`}>{event.name}</a>
              <p>
                {event.eventDate.slice(0, 10)} · {event.division} {event.section} · {event.courts} courts
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
