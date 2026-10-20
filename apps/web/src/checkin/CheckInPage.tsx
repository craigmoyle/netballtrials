import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { PublicTrialDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';

type Client = ReturnType<typeof apiClient>;

export function CheckInPage({ client, eventId }: { client: Client; eventId?: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventIdFromQuery = eventId ? '' : searchParams.get('eventId') ?? '';
  const initialEventId = eventId ?? eventIdFromQuery;
  const [eventIdInput, setEventIdInput] = useState(initialEventId);
  const [eventPreview, setEventPreview] = useState<PublicTrialDTO | null>(null);
  const [previewState, setPreviewState] = useState<'loading' | 'verified' | 'unverified' | null>(null);
  const [publicEvents, setPublicEvents] = useState<PublicTrialDTO[]>([]);
  const [publicEventsState, setPublicEventsState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [eventListAttempt, setEventListAttempt] = useState(0);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isGenericEntry = !eventId && !eventIdFromQuery;

  useEffect(() => setEventIdInput(initialEventId), [initialEventId]);

  useEffect(() => {
    if (eventId) return;
    let active = true;
    setPublicEventsState('loading');
    if (eventIdFromQuery) {
      setEventPreview(null);
      setPreviewState('loading');
    }
    client.listPublicEvents()
      .then((events) => {
        if (!active) return;
        setPublicEvents(events);
        setPublicEventsState('loaded');
        if (eventIdFromQuery) {
          const match = events.find((trial) => trial.id === eventIdFromQuery);
          setEventPreview(match ?? null);
          setPreviewState(match ? 'verified' : 'unverified');
        }
      })
      .catch(() => {
        if (!active) return;
        setPublicEventsState('error');
        if (eventIdFromQuery) setPreviewState('unverified');
      });
    return () => { active = false; };
  }, [client, eventId, eventIdFromQuery, eventListAttempt]);

  const verifiedEvent = previewState === 'verified' && eventPreview?.id === eventIdInput
    ? eventPreview
    : null;

  async function onSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    setError(null);
    if (!eventIdInput.trim()) {
      setError(isGenericEntry ? 'Choose a trial.' : 'Enter the Event ID.');
      return;
    }
    if (!pin.trim()) {
      setError('Enter the Event PIN.');
      return;
    }
    setBusy(true);
    try {
      await client.openCheckIn(eventIdInput, pin);
      navigate('/check-in/scan');
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) setError('PIN is incorrect.');
      else if (status === 429) setError('Too many attempts. Wait a few minutes and try again.');
      else if (status === 409) setError('Check-in is closed for this event.');
      else setError('Could not start check-in. Check the event and PIN.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Check-in</h1>
      <p>{eventId ? 'Enter the Event PIN for this trial.' : isGenericEntry ? 'Choose your trial, then enter the Event PIN.' : 'Enter the Event ID and PIN for your trial. If you don’t have them, ask your event coordinator.'}</p>
      {isGenericEntry && publicEventsState === 'loading' ? <p role="status">Loading upcoming trials...</p> : null}
      {isGenericEntry && publicEventsState === 'error' ? (
        <p role="alert">
          Could not load upcoming trials. Try again, or ask your event coordinator for a direct check-in link.{' '}
          <button type="button" onClick={() => setEventListAttempt((attempt) => attempt + 1)}>Try again</button>
        </p>
      ) : null}
      {isGenericEntry && publicEventsState === 'loaded' && publicEvents.length === 0 ? (
        <p role="status">No upcoming trials are available for check-in. Ask your event coordinator for a direct check-in link.</p>
      ) : null}
      {eventIdFromQuery ? (
        verifiedEvent ? <p role="status">{verifiedEvent.name} · {formatTrialDate(verifiedEvent.eventDate)}</p>
          : previewState === 'loading' && eventIdInput === eventIdFromQuery
            ? <p role="status">Checking trial details...</p>
            : <p role="status">Could not verify this Event ID. Confirm the Event ID with your coordinator before starting check-in.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={onSubmit} noValidate>
        {eventId ? null : eventIdFromQuery ? (
          <p>
            <label htmlFor="eventId">Event ID</label>
            <input
              id="eventId"
              required
              value={eventIdInput}
              onChange={(e) => {
                const value = e.target.value;
                setEventIdInput(value);
                if (value !== eventIdFromQuery) {
                  setEventPreview(null);
                  setPreviewState('unverified');
                }
              }}
            />
          </p>
        ) : (
          <p>
            <label htmlFor="eventId">Trial</label>
            <select
              id="eventId"
              required
              value={eventIdInput}
              disabled={publicEventsState !== 'loaded' || publicEvents.length === 0}
              onChange={(e) => {
                setEventIdInput(e.target.value);
                setError(null);
              }}
            >
              <option value="">Choose a trial</option>
              {publicEvents.map((trial) => (
                <option key={trial.id} value={trial.id}>
                  {trial.name} · {formatTrialDate(trial.eventDate)} · {trial.venue}
                </option>
              ))}
            </select>
          </p>
        )}
        <p>
          <label htmlFor="pin">Event PIN</label>
          <input
            id="pin"
            type="password"
            required
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </p>
        <button type="submit" disabled={busy || (isGenericEntry && (publicEventsState !== 'loaded' || publicEvents.length === 0))}>
          {busy ? 'Starting...' : 'Start check-in'}
        </button>
      </form>
    </section>
  );
}
