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
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.checkInSettings(eventId)
      .then((settings) => {
        if (!active) return;
        setPinConfigured(settings.pinConfigured);
        setCheckInClosedAt(settings.checkInClosedAt);
      })
      .catch(() => { if (active) setCheckInError('Could not load check-in settings.'); });
    return () => { active = false; };
  }, [client, eventId]);

  async function changeLifecycle() {
    if (status === 'OPEN' && !window.confirm('Close registration for this event? Families will no longer be able to register.')) return;
    setBusy(true);
    setEventError(null);
    setEventMessage(null);
    try {
      const updated = status === 'DRAFT' ? await client.openEvent(eventId) : await client.closeEvent(eventId);
      onStatusChange(updated.status);
      setEventMessage(status === 'DRAFT' ? 'Registration is open.' : 'Registration is closed.');
    } catch {
      setEventError('Could not change the event status. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    if (!/^\d{4,8}$/.test(pin)) {
      setPinError('PIN must contain 4 to 8 digits.');
      setPinMessage(null);
      return;
    }
    setBusy(true);
    setPinError(null);
    setPinMessage(null);
    try {
      await client.setCheckInPin(eventId, pin);
      setPinConfigured(true);
      setPinMessage('Check-in PIN saved. Share the displayed PIN with approved volunteers; it is stored as a hash.');
    } catch {
      setPinError('Could not save the PIN. It has not been shown or changed; try again.');
    } finally {
      setBusy(false);
    }
  }

  async function clearPin() {
    if (!window.confirm('Remove the check-in PIN and revoke current volunteer sessions?')) return;
    setBusy(true);
    setCheckInError(null);
    setCheckInMessage(null);
    try {
      await client.clearCheckInPin(eventId);
      setPinConfigured(false);
      setPin('');
      setPinError(null);
      setPinMessage(null);
      setCheckInMessage('PIN removed. Existing volunteer sessions have been revoked.');
    } catch {
      setCheckInError('Could not remove the PIN. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function closeCheckIn() {
    if (!window.confirm('Close volunteer check-in and revoke current sessions?')) return;
    setBusy(true);
    setCheckInError(null);
    setCheckInMessage(null);
    try {
      await client.closeCheckIn(eventId);
      setCheckInClosedAt(new Date().toISOString());
      setCheckInMessage('Volunteer check-in is closed.');
    } catch {
      setCheckInError('Could not close check-in. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  const canRegisterDayOf = status !== 'DRAFT' && eventDate.slice(0, 10) === melbourneDateKey(new Date()) &&
    pinConfigured !== null && !checkInClosedAt;

  return (
    <section aria-labelledby="event-controls-heading">
      <h2 id="event-controls-heading">Event controls</h2>
      {(pinConfigured !== null && !checkInClosedAt) || canRegisterDayOf ? (
        <nav aria-label="Event actions" className="workflow-links">
          {pinConfigured !== null && !checkInClosedAt ? <Link to={`/admin/events/${eventId}/check-in`}>Admin check-in</Link> : null}
          {canRegisterDayOf ? <Link to={`/admin/events/${eventId}/day-of-registration`}>Add day-of player</Link> : null}
        </nav>
      ) : null}
      <h3>Registration</h3>
      <p>Status: {status.toLowerCase()}</p>
      {status === 'DRAFT' ? (
        <button type="button" disabled={busy} onClick={changeLifecycle}>Open registration</button>
      ) : status === 'OPEN' ? (
        <div className="event-action-group">
          <button type="button" className="button-secondary" disabled={busy} onClick={changeLifecycle}>Close event</button>
          <p className="event-consequence-note">Closing registration prevents new families from registering. This event cannot be reopened from Event operations.</p>
        </div>
      ) : null}
      {eventError ? <p role="alert">{eventError}</p> : null}
      {eventMessage ? <p role="status">{eventMessage}</p> : null}
      <h3>Volunteer check-in</h3>
      <p>PIN: {pinConfigured === null ? 'Loading status...' : pinConfigured ? 'Configured' : 'Not configured'}</p>
      <p>Status: {checkInClosedAt ? 'Closed' : 'Open'}</p>
      <p>
        <label htmlFor="checkInPin">Set or rotate check-in PIN</label>
        <input
          id="checkInPin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          aria-invalid={pinError ? true : undefined}
          aria-describedby={pinError ? 'checkInPin-error' : undefined}
          onChange={(event) => { setPin(event.target.value); setPinError(null); setPinMessage(null); }}
        />
        {pinError ? <span id="checkInPin-error" role="alert">{pinError}</span> : null}
        {pinMessage ? <span role="status">{pinMessage}</span> : null}
        <button type="button" disabled={busy || pin.length === 0} onClick={savePin}>Set or rotate PIN</button>
      </p>
      {pinConfigured ? (
        <div className="event-action-group">
          <button type="button" className="button-secondary" disabled={busy} onClick={clearPin}>Remove PIN</button>
          <p className="event-consequence-note">Removing the PIN revokes current volunteer sessions. You can set a new PIN later.</p>
        </div>
      ) : null}
      {!checkInClosedAt ? (
        <div className="event-action-group">
          <button type="button" className="button-secondary" disabled={busy} onClick={closeCheckIn}>Close check-in</button>
          <p className="event-consequence-note">Closing check-in revokes active volunteer sessions. This event’s check-in cannot be reopened.</p>
        </div>
      ) : null}
      {checkInError ? <p role="alert">{checkInError}</p> : null}
      {checkInMessage ? <p role="status">{checkInMessage}</p> : null}
      <EventCourtColors client={client} eventId={eventId} courts={courts} />
    </section>
  );
}
