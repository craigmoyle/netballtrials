import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { melbourneDateKey, type EventStatus } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { EventCourtColors } from './EventCourtColors';
import { melbourneDateTimeInput } from '../eventDeadline';
import { HelpTip } from './HelpTip';

export function EventControls({
  client,
  eventId,
  eventDate,
  courts,
  status,
  registrationClosesAt,
  registrationClosedAt,
  onStatusChange,
  onRegistrationChange,
}: {
  client: Client;
  eventId: string;
  eventDate: string;
  courts: number;
  status: EventStatus;
  registrationClosesAt: string;
  registrationClosedAt: string | null;
  onStatusChange: (status: EventStatus) => void;
  onRegistrationChange: (registrationClosesAt: string, registrationClosedAt: string | null) => void;
}) {
  const [pinConfigured, setPinConfigured] = useState<boolean | null>(null);
  const [checkInClosedAt, setCheckInClosedAt] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [reopenDeadline, setReopenDeadline] = useState(() => melbourneDateTimeInput(registrationClosesAt));
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [checkInSettingsError, setCheckInSettingsError] = useState<string | null>(null);
  const [pinRemovalError, setPinRemovalError] = useState<string | null>(null);
  const [pinRemovalMessage, setPinRemovalMessage] = useState<string | null>(null);
  const [checkInCloseError, setCheckInCloseError] = useState<string | null>(null);
  const [checkInCloseMessage, setCheckInCloseMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.checkInSettings(eventId)
      .then((settings) => {
        if (!active) return;
        setPinConfigured(settings.pinConfigured);
        setCheckInClosedAt(settings.checkInClosedAt);
      })
      .catch(() => { if (active) setCheckInSettingsError('Could not load check-in settings.'); });
    return () => { active = false; };
  }, [client, eventId]);

  const registrationOpen = status === 'OPEN' && !registrationClosedAt && new Date(registrationClosesAt).getTime() > Date.now();
  const canReopen = status === 'CLOSED' || (status === 'OPEN' && !registrationOpen);

  async function changeLifecycle(reopen = false) {
    if (status === 'OPEN' && !reopen && !window.confirm('Close registration for this event? Families will no longer be able to register.')) return;
    if (reopen && (!reopenDeadline || !window.confirm('Reopen public registration with this deadline?'))) return;
    setBusy(true);
    setEventError(null);
    setEventMessage(null);
    try {
      const updated = status === 'DRAFT'
        ? await client.openEvent(eventId)
        : reopen
          ? await client.openEvent(eventId, { registrationClosesAt: reopenDeadline, confirmReopen: true })
          : await client.closeEvent(eventId);
      onStatusChange(updated.status);
      onRegistrationChange(updated.registrationClosesAt, updated.registrationClosedAt);
      setEventMessage(reopen ? 'Registration is open again.' : status === 'DRAFT' ? 'Registration is open.' : 'Registration is closed.');
      if (reopen) setReopenDeadline(melbourneDateTimeInput(updated.registrationClosesAt));
    } catch {
      setEventError('Could not change the event status. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    if (!/^\d{6,8}$/.test(pin)) {
      setPinError('PIN must contain 6 to 8 digits.');
      setPinMessage(null);
      return;
    }
    setBusy(true);
    setPinError(null);
    setPinMessage(null);
    try {
      await client.setCheckInPin(eventId, pin);
      setPinConfigured(true);
      setPinRemovalError(null);
      setPinRemovalMessage(null);
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
    setPinRemovalError(null);
    setPinRemovalMessage(null);
    try {
      await client.clearCheckInPin(eventId);
      setPinConfigured(false);
      setPin('');
      setPinError(null);
      setPinMessage(null);
      setPinRemovalMessage('PIN removed. Existing volunteer sessions have been revoked.');
    } catch {
      setPinRemovalError('Could not remove the PIN. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function reopenCheckIn() {
    if (!window.confirm('Reopen check-in for this event? Approved volunteers will be able to use the configured PIN again.')) return;
    setBusy(true);
    setCheckInCloseError(null);
    setCheckInCloseMessage(null);
    try {
      await client.reopenCheckIn(eventId);
      setCheckInClosedAt(null);
      setCheckInCloseMessage('Check-in is open again.');
    } catch {
      setCheckInCloseError('Could not reopen check-in. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function closeCheckIn() {
    if (!window.confirm('Close volunteer check-in and revoke current sessions?')) return;
    setBusy(true);
    setCheckInCloseError(null);
    setCheckInCloseMessage(null);
    try {
      await client.closeCheckIn(eventId);
      setCheckInClosedAt(new Date().toISOString());
      setCheckInCloseMessage('Volunteer check-in is closed.');
    } catch {
      setCheckInCloseError('Could not close check-in. Refresh this page and try again.');
    } finally {
      setBusy(false);
    }
  }

  const canRegisterDayOf = status !== 'DRAFT' && eventDate.slice(0, 10) === melbourneDateKey(new Date()) &&
    pinConfigured !== null;

  return (
    <section className="event-controls" aria-labelledby="event-controls-heading">
      <div className="admin-page-title-row"><h2 id="event-controls-heading">Event controls</h2><HelpTip label="Registration and check-in access">Opening registration lets families submit applications. The volunteer PIN is shared with approved volunteers and stored as a hash; closing check-in revokes their active sessions.</HelpTip></div>
      {(pinConfigured !== null && !checkInClosedAt) || canRegisterDayOf ? (
        <nav aria-label="Event actions" className="workflow-links">
          {pinConfigured !== null && !checkInClosedAt ? <Link to={`/admin/events/${eventId}/check-in`}>Admin check-in</Link> : null}
          {canRegisterDayOf ? <Link to={`/admin/events/${eventId}/day-of-registration`}>Add day-of player</Link> : null}
        </nav>
      ) : null}
      <h3>Registration</h3>
      <p>Event status: {status.toLowerCase()}</p>
      <p>Registration: {status === 'DRAFT' ? 'Not open' : registrationOpen ? 'Open' : 'Closed'}</p>
      <p>Deadline: {new Date(registrationClosesAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} Melbourne time</p>
      {status === 'DRAFT' ? (
        <button type="button" disabled={busy} onClick={() => void changeLifecycle()}>Open registration</button>
      ) : registrationOpen ? (
        <div className="event-action-group">
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void changeLifecycle()}>Close registration</button>
          <p className="event-consequence-note">Closing registration prevents new families from registering. Existing accepted registrations can continue.</p>
        </div>
      ) : canReopen ? (
        <div className="event-action-group">
          <label htmlFor="reopenDeadline">New registration deadline (Melbourne time)</label>
          <input id="reopenDeadline" type="datetime-local" value={reopenDeadline} onChange={(event) => setReopenDeadline(event.target.value)} />
          <button type="button" disabled={busy || !reopenDeadline} onClick={() => void changeLifecycle(true)}>Reopen registration</button>
          <p className="event-consequence-note">Choose a future deadline no later than arrival. Reopening requires explicit confirmation.</p>
        </div>
      ) : null}
      {eventError ? <p role="alert">{eventError}</p> : null}
      {eventMessage ? <p role="status">{eventMessage}</p> : null}
      <h3>Volunteer check-in</h3>
      <p>PIN: {pinConfigured === null ? 'Loading status...' : pinConfigured ? 'Configured' : 'Not configured'}</p>
      <p>Status: {checkInClosedAt ? 'Closed' : 'Open'}</p>
      {checkInSettingsError ? <p role="alert">{checkInSettingsError}</p> : null}
      <p>
        <label htmlFor="checkInPin">Set or rotate check-in PIN</label>
        <span id="checkInPin-hint" className="field-hint">Use 6 to 8 digits.</span>
        <input
          id="checkInPin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          minLength={6}
          maxLength={8}
          pattern="[0-9]{6,8}"
          value={pin}
          aria-invalid={pinError ? true : undefined}
          aria-describedby={pinError ? 'checkInPin-hint checkInPin-error' : 'checkInPin-hint'}
          onChange={(event) => {
            setPin(event.target.value);
            setPinError(null);
            setPinMessage(null);
            setPinRemovalError(null);
            setPinRemovalMessage(null);
          }}
        />
        {pinError ? <span id="checkInPin-error" role="alert">{pinError}</span> : null}
        {pinMessage ? <span role="status">{pinMessage}</span> : null}
        <button type="button" disabled={busy || pin.length === 0} onClick={savePin}>Set or rotate PIN</button>
      </p>
      {pinConfigured || pinRemovalError || pinRemovalMessage ? (
        <div className="event-action-group">
          {pinConfigured ? <button type="button" className="button-secondary" disabled={busy} onClick={clearPin}>Remove PIN</button> : null}
          {pinConfigured ? <p className="event-consequence-note">Removing the PIN revokes current volunteer sessions. You can set a new PIN later.</p> : null}
          {pinRemovalError ? <p role="alert">{pinRemovalError}</p> : null}
          {pinRemovalMessage ? <p role="status">{pinRemovalMessage}</p> : null}
        </div>
      ) : null}
      <div className="event-action-group">
        {checkInClosedAt
          ? <><button type="button" className="button-secondary" disabled={busy} onClick={reopenCheckIn}>Reopen check-in</button><p className="event-consequence-note">Reopening requires explicit Admin confirmation and makes the configured PIN usable again on the Melbourne event date.</p></>
          : <><button type="button" className="button-secondary" disabled={busy} onClick={closeCheckIn}>Close check-in</button><p className="event-consequence-note">Closing check-in revokes active volunteer sessions and creates the initial final-roster snapshot.</p></>}
        {checkInCloseError ? <p role="alert">{checkInCloseError}</p> : null}
        {checkInCloseMessage ? <p role="status">{checkInCloseMessage}</p> : null}
      </div>
      <EventCourtColors client={client} eventId={eventId} courts={courts} />
    </section>
  );
}
