import { useEffect, useState } from 'react';
import type { EventDTO } from '@netball-trials/types';
import { formatTrialDate } from '../formatTrialDate';
import type { ApiClient as Client } from '../api/client';
import { EventControls } from './EventControls';

export function EventOperationsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [loaded, setLoaded] = useState<{ eventId: string; event: EventDTO } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const event = loaded?.eventId === eventId ? loaded.event : null;

  useEffect(() => {
    let active = true;
    setLoadError(false);
    client.getEvent(eventId)
      .then((loadedEvent) => { if (active) { setLoaded({ eventId, event: loadedEvent }); setLoadError(false); } })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [client, eventId, retry]);

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
        <p role="alert">Could not load event operations. <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry loading event operations</button></p>
      ) : <p role="status">Loading event operations...</p>}
    </section>
  );
}
