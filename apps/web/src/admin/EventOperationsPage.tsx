import { useEffect, useState } from 'react';
import type { EventDTO } from '@netball-trials/types';
import { formatTrialDate } from '../formatTrialDate';
import type { apiClient } from '../api/client';
import { EventControls } from './EventControls';

type Client = ReturnType<typeof apiClient>;

export function EventOperationsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [loaded, setLoaded] = useState<{ eventId: string; event: EventDTO } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const event = loaded?.eventId === eventId ? loaded.event : null;

  useEffect(() => {
    let active = true;
    setLoadError(false);
    client.getEvent(eventId)
      .then((loadedEvent) => { if (active) setLoaded({ eventId, event: loadedEvent }); })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [client, eventId]);

  return (
    <section>
      <h1>Event operations</h1>
      {event ? <p className="event-form-context">{event.name} · {formatTrialDate(event.eventDate)}</p> : null}
      {event ? (
        <EventControls
          client={client}
          eventId={eventId}
          eventDate={event.eventDate}
          courts={event.courts}
          status={event.status}
          onStatusChange={(status) => setLoaded((current) => current?.eventId === eventId
            ? { ...current, event: { ...current.event, status } }
            : current)}
        />
      ) : loadError ? (
        <p role="alert">Could not load event operations. Refresh this page and try again.</p>
      ) : <p role="status">Loading event operations...</p>}
    </section>
  );
}
