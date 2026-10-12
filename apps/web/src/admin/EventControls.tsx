import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { melbourneDateKey, type EventStatus } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { EventCourtColors } from './EventCourtColors';

type Client = ReturnType<typeof apiClient>;

export function EventControls({
  client,
  eventId,
  eventDate,
  courts,
  status,
  onStatusChange,
}: {
  client: Client;
  eventId: string;
  eventDate: string;
  courts: number;
  status: EventStatus;
  onStatusChange: (status: EventStatus) => void;
}) {
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [checkInClosedAt, setCheckInClosedAt] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.checkInSettings(eventId)
      .then((settings) => {
        if (!active) return;
        setPinConfigured(settings.pinConfigured);
        setCheckInClosedAt(settings.checkInClosedAt);
      })
      .catch(() => { if (active) setError('Could not load check-in settings.'); });
    return () => { active = false; };
  }, [client, eventId]);

  async function changeLifecycle() {
    if (status === 'OPEN' && !window.confirm('Close registration for this event? Families will no longer be able to register.')) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = status === 'DRAFT' ? await client.openEvent(eventId) : await client.closeEvent(eventId);
      onStatusChange(updated.status);
      setMessage(status === 'DRAFT' ? 'Registration is open.' : 'Registration is closed.');
    } catch {
      setError('Could not change the event status. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN must contain 4 to 8 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.setCheckInPin(eventId, pin);
      setPinConfigured(true);
      setMessage('Check-in PIN saved. Share the displayed PIN with approved volunteers; it is stored as a hash.');
    } catch {
      setError('Could not save the PIN. It has not been shown or changed; try again.');
    } finally {
      setBusy(false);
    }
  }

  async function clearPin() {
    if (!window.confirm('Remove the check-in PIN and revoke current volunteer sessions?')) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.clearCheckInPin(eventId);
      setPinConfigured(false);
      setPin('');
      setMessage('PIN removed. Existing volunteer sessions have been revoked.');
    } catch {
      setError('Could not remove the PIN. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function closeCheckIn() {
    if (!window.confirm('Close volunteer check-in and revoke current sessions?')) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.closeCheckIn(eventId);
      setCheckInClosedAt(new Date().toISOString());
      setMessage('Volunteer check-in is closed.');
    } catch {
      setError('Could not close check-in. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  const canRegisterDayOf = status !== 'DRAFT' && eventDate.slice(0, 10) === melbourneDateKey(new Date()) &&
    pinConfigured !== null && !checkInClosedAt;

  return (
    <section aria-labelledby="event-controls-heading">
      <h2 id="event-controls-heading">Event controls</h2>
      <p>Status: {status.toLowerCase()}</p>
      {status !== 'CLOSED' ? (
        <button type="button" disabled={busy} onClick={changeLifecycle}>
          {status === 'DRAFT' ? 'Open registration' : 'Close event'}
        </button>
      ) : null}
      <h3>Volunteer check-in</h3>
      <p>PIN: {pinConfigured === null ? 'Loading status...' : pinConfigured ? 'Configured' : 'Not configured'}</p>
      <p>Status: {checkInClosedAt ? 'Closed' : 'Open'}</p>
      <p>
        <label htmlFor="checkInPin">Set or rotate check-in PIN</label>
        <input id="checkInPin" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value)} />
        <button type="button" disabled={busy || pin.length === 0} onClick={savePin}>Set or rotate PIN</button>
      </p>
      {pinConfigured ? <button type="button" disabled={busy} onClick={clearPin}>Remove PIN</button> : null}{' '}
      {!checkInClosedAt ? <button type="button" disabled={busy} onClick={closeCheckIn}>Close check-in</button> : null}
      <EventCourtColors client={client} eventId={eventId} courts={courts} />
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <nav aria-label="Event workflows" className="workflow-links">
        <Link to={`/admin/events/${eventId}/roster`}>Roster and export</Link>
        <Link to={`/admin/events/${eventId}/review`}>Review queue</Link>
        <Link to={`/admin/events/${eventId}/plan`}>Plan rounds</Link>
        <Link to={`/admin/events/${eventId}/messages`}>Messages</Link>
        <Link to={`/admin/events/${eventId}/sheets`}>Print selector sheets</Link>
        {pinConfigured !== null && !checkInClosedAt ? <Link to={`/admin/events/${eventId}/check-in`}>Admin check-in</Link> : null}
        {canRegisterDayOf ? <Link to={`/admin/events/${eventId}/day-of-registration`}>Add day-of player</Link> : null}
        <Link to="/admin/associations">Member associations</Link>
        <Link to="/check-in">Volunteer check-in</Link>
      </nav>
    </section>
  );
}
