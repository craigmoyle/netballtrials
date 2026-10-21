import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { defaultAgeRange } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';
import { useUnsavedSignOut } from '../useUnsavedSignOut';

type FormState = Record<string, string>;

const EMPTY: FormState = {
  name: '', competitionYear: String(new Date().getFullYear() + 1), division: '', section: 'Ladies',
  eventDate: '', venue: '', startTime: '08:30', endTime: '12:00', gameStartTime: '09:00',
  registrationFeeCents: '0', courts: '1', rank1Min: '2', rank2Min: '1', rank3Min: '1',
  playMinutes: '8', changeoverMinutes: '2', minAge: '5', maxAge: '99', policyUrl: '',
};

const NUMERIC = new Set([
  'competitionYear', 'courts', 'rank1Min', 'rank2Min', 'rank3Min', 'playMinutes',
  'changeoverMinutes', 'minAge', 'maxAge',
]);

const FIELD_GROUPS: { legend: string; fields: { name: string; label: string; type: string }[] }[] = [
  {
    legend: 'Event details',
    fields: [
      { name: 'name', label: 'Event name', type: 'text' },
      { name: 'competitionYear', label: 'Competition year', type: 'number' },
      { name: 'division', label: 'Division', type: 'text' },
      { name: 'section', label: 'Section', type: 'text' },
      { name: 'eventDate', label: 'Event date', type: 'date' },
      { name: 'venue', label: 'Venue', type: 'text' },
      { name: 'startTime', label: 'Arrival time', type: 'time' },
      { name: 'gameStartTime', label: 'Start time', type: 'time' },
      { name: 'endTime', label: 'Finish time', type: 'time' },
      { name: 'registrationFeeCents', label: 'Registration fee (AUD)', type: 'number' },
    ],
  },
  {
    legend: 'Trial format',
    fields: [
      { name: 'courts', label: 'Courts', type: 'number' },
      { name: 'playMinutes', label: 'Playing minutes', type: 'number' },
      { name: 'changeoverMinutes', label: 'Changeover minutes', type: 'number' },
    ],
  },
  {
    legend: 'Selection settings',
    fields: [
      { name: 'rank1Min', label: 'Minimum games in first choice', type: 'number' },
      { name: 'rank2Min', label: 'Minimum games in second choice', type: 'number' },
      { name: 'rank3Min', label: 'Minimum games in third choice', type: 'number' },
      { name: 'minAge', label: 'Minimum age at 31 December', type: 'number' },
      { name: 'maxAge', label: 'Maximum age at 31 December', type: 'number' },
      { name: 'policyUrl', label: 'Selection policy URL', type: 'url' },
    ],
  },
];
const FIELDS = FIELD_GROUPS.flatMap((group) => group.fields);

export function EventFormPage({ client }: { client: Client }) {
  const { id } = useParams();
  return <EventForm key={id ?? 'new'} client={client} id={id} />;
}

function EventForm({ client, id }: { client: Client; id: string | undefined }) {
  const mounted = useRef(false);
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedEventName, setSavedEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [loadedEventId, setLoadedEventId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const savedForm = useRef<FormState>(EMPTY);
  const navigationBlocked = useRef(false);
  const allowedDestination = useRef<string | null>(null);
  const promptedLocation = useRef<string | null>(null);

  navigationBlocked.current = Object.entries(form).some(([field, value]) => savedForm.current[field] !== value);
  const shouldBlockNavigation = useCallback(({ nextLocation }: { nextLocation: { pathname: string } }) => {
    if (allowedDestination.current === nextLocation.pathname) {
      allowedDestination.current = null;
      return false;
    }
    return navigationBlocked.current;
  }, []);
  const blocker = useBlocker(shouldBlockNavigation);
  useUnsavedSignOut(navigationBlocked.current, 'You have unsaved event changes. Leave without saving?');

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptedLocation.current = null;
      return;
    }
    const destination = `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`;
    if (promptedLocation.current === destination) return;
    promptedLocation.current = destination;
    if (window.confirm('You have unsaved event changes. Leave without saving?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  useEffect(() => {
    const confirmUnload = (event: BeforeUnloadEvent) => {
      if (!navigationBlocked.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', confirmUnload);
    return () => window.removeEventListener('beforeunload', confirmUnload);
  }, []);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoadError(false);
    client
      .getEvent(id)
      .then((event) => {
        if (!active) return;
        setSavedEventName(event.name);
        setEventDate(event.eventDate);
        const loadedForm: FormState = {
          name: event.name,
          competitionYear: String(event.competitionYear),
          division: event.division,
          section: event.section,
          eventDate: event.eventDate.slice(0, 10),
          venue: event.venue,
          startTime: event.startTime,
          gameStartTime: event.gameStartTime,
          endTime: event.endTime,
          registrationFeeCents: (event.registrationFeeCents / 100).toFixed(2),
          courts: String(event.courts),
          rank1Min: String(event.rank1Min),
          rank2Min: String(event.rank2Min),
          rank3Min: String(event.rank3Min),
          playMinutes: String(event.playMinutes),
          changeoverMinutes: String(event.changeoverMinutes),
          minAge: String(event.minAge),
          maxAge: String(event.maxAge),
          policyUrl: event.policyUrl ?? '',
        };
        savedForm.current = loadedForm;
        setForm(loadedForm);
        setLoadedEventId(id);
      })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [client, id, loadAttempt]);

  useEffect(() => {
    if (fieldErrors.length > 0) errorSummary.current?.focus();
  }, [fieldErrors]);

  function updateField(name: string, value: string) {
    if (busy) return;
    setForm((previous) => {
      const next = { ...previous, [name]: value };
      if (!id && name === 'division') {
        const range = defaultAgeRange(value);
        next.minAge = String(range.minAge);
        next.maxAge = String(range.maxAge);
      }
      return next;
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const missingNumbers = FIELDS
      .filter((field) => field.type === 'number' && (form[field.name] ?? '').trim() === '')
      .map((field) => field.name);
    if (missingNumbers.length > 0) {
      setFieldErrors(missingNumbers);
      setError('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors([]);

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (key === 'policyUrl' && value.trim() === '') {
        if (id) payload[key] = null;
        continue;
      }
      if (key === 'registrationFeeCents') payload[key] = Math.round(Number(value) * 100);
      else payload[key] = NUMERIC.has(key) ? Number(value) : value;
    }

    try {
      if (id) await client.updateEvent(id, payload as never);
      else await client.createEvent(payload as never);
      if (!mounted.current) return;
      savedForm.current = form;
      navigationBlocked.current = false;
      allowedDestination.current = '/admin/events';
      navigate('/admin/events');
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError) {
        setFieldErrors(err.fields ?? []);
        setError(err.status === 400 ? 'Please fix the highlighted fields.' : 'Could not save the event. Your changes are still here. Try again.');
      } else {
        setError('Could not save the event. Your changes are still here. Try again.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function cancelEditing() {
    navigate('/admin/events');
  }

  async function removeEvent() {
    if (!id || busy) return;
    const confirmed = window.confirm(`Delete "${savedEventName}"? This permanently removes the event, its plans, court colors, policy document, check-in sessions and email history. Only events with no registrations can be deleted.`);
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      await client.deleteEvent(id);
      if (!mounted.current) return;
      navigationBlocked.current = false;
      allowedDestination.current = '/admin/events';
      navigate('/admin/events');
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof ApiError && reason.status === 409 && reason.message === 'event_has_registrations') {
        setError('This event cannot be deleted because registration records exist. No event data was changed.');
      } else {
        setError('Could not delete this event. No event data was changed; try again.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section>
      <p><Link to="/admin/events">Back to events</Link></p>
      <h1>{id ? 'Edit event' : 'New event'}</h1>
      {id && loadedEventId !== id ? (loadError ? (
        <>
          <p role="alert">Could not load the event.</p>
          <button type="button" className="button-secondary" onClick={() => { setLoadError(false); setLoadAttempt((attempt) => attempt + 1); }}>Try again</button>
        </>
      ) : <p role="status">Loading event details...</p>) : <>
      {id && savedEventName && eventDate ? <p className="event-form-context">{savedEventName} · {formatTrialDate(eventDate)}</p> : null}
      {fieldErrors.length > 0 ? (
        <div ref={errorSummary} role="alert" aria-labelledby="event-errors-title" tabIndex={-1} className="error-summary">
          <h2 id="event-errors-title">Check these event details</h2>
          <ul>{fieldErrors.map((field) => <li key={field}><a href={`#${field}`}>{FIELDS.find((item) => item.name === field)?.label ?? field}</a></li>)}</ul>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={onSubmit} noValidate>
        {FIELD_GROUPS.map((group) => (
          <fieldset className="form-group" key={group.legend} disabled={busy}>
            <legend>{group.legend}</legend>
            {group.fields.map((field) => {
              const invalid = fieldErrors.includes(field.name);
              return (
                <p key={field.name}>
                  <label htmlFor={field.name}>{field.label}</label>
                  <input
                    id={field.name}
                    name={field.name}
                    type={field.type}
                    min={field.name === 'registrationFeeCents' ? '0' : undefined}
                    step={field.name === 'registrationFeeCents' ? '0.01' : undefined}
                    list={field.name === 'division' ? 'trial-divisions' : undefined}
                    value={form[field.name] ?? ''}
                    onChange={(changeEvent) => updateField(field.name, changeEvent.target.value)}
                    aria-invalid={invalid || undefined}
                    aria-describedby={[invalid ? `${field.name}-error` : '', field.name === 'policyUrl' ? 'policyUrl-hint' : ''].filter(Boolean).join(' ') || undefined}
                  />
                  {field.name === 'division' ? <datalist id="trial-divisions"><option value="15/U" /><option value="17/U" /><option value="Open" /><option value="All Abilities" /></datalist> : null}
                  {field.name === 'policyUrl' ? <span id="policyUrl-hint">Leave blank to use the club’s default selection policy.</span> : null}
                  {invalid ? <span id={`${field.name}-error`}>{field.label} is not valid.</span> : null}
                </p>
              );
            })}
          </fieldset>
        ))}
        <p className="workflow-links">
          <button type="button" className="button-secondary" disabled={busy} onClick={cancelEditing}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save event'}</button>
        </p>
      </form>
      {id && loadedEventId === id ? (
        <section aria-labelledby="delete-event-heading">
          <h2 id="delete-event-heading">Delete event</h2>
          <p>Deleting an event removes its settings, plans, court colors, policy document, check-in sessions and email history. Any registration record, including withdrawn or pending, blocks deletion.</p>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => void removeEvent()}>{busy ? 'Deleting...' : 'Delete event'}</button>
        </section>
      ) : null}
      </>}
    </section>
  );
}
