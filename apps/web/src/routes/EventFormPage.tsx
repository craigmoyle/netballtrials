import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, type apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;
type FormState = Record<string, string>;

const EMPTY: FormState = {
  name: '',
  competitionYear: String(new Date().getFullYear() + 1),
  division: '',
  section: 'Ladies',
  eventDate: '',
  venue: '',
  startTime: '08:30',
  endTime: '12:00',
  firstWhistle: '09:00',
  lastWhistle: '11:30',
  registrationFeeCents: '0',
  courts: '1',
  rank1Min: '2',
  rank2Min: '1',
  rank3Min: '1',
  playMinutes: '8',
  changeoverMinutes: '2',
  minAge: '5',
  maxAge: '99',
  policyUrl: '',
};

const NUMERIC = new Set([
  'competitionYear',
  'registrationFeeCents',
  'courts',
  'rank1Min',
  'rank2Min',
  'rank3Min',
  'playMinutes',
  'changeoverMinutes',
  'minAge',
  'maxAge',
]);

const FIELDS: { name: string; label: string; type: string }[] = [
  { name: 'name', label: 'Event name', type: 'text' },
  { name: 'competitionYear', label: 'Competition year', type: 'number' },
  { name: 'division', label: 'Division', type: 'text' },
  { name: 'section', label: 'Section', type: 'text' },
  { name: 'eventDate', label: 'Event date', type: 'date' },
  { name: 'venue', label: 'Venue', type: 'text' },
  { name: 'startTime', label: 'Arrival time', type: 'time' },
  { name: 'endTime', label: 'Finish time', type: 'time' },
  { name: 'firstWhistle', label: 'First whistle', type: 'time' },
  { name: 'lastWhistle', label: 'Last whistle', type: 'time' },
  { name: 'registrationFeeCents', label: 'Registration fee (cents)', type: 'number' },
  { name: 'courts', label: 'Courts', type: 'number' },
  { name: 'rank1Min', label: 'Minimum games in first choice', type: 'number' },
  { name: 'rank2Min', label: 'Minimum games in second choice', type: 'number' },
  { name: 'rank3Min', label: 'Minimum games in third choice', type: 'number' },
  { name: 'playMinutes', label: 'Playing minutes', type: 'number' },
  { name: 'changeoverMinutes', label: 'Changeover minutes', type: 'number' },
  { name: 'minAge', label: 'Minimum age at 31 December', type: 'number' },
  { name: 'maxAge', label: 'Maximum age at 31 December', type: 'number' },
  { name: 'policyUrl', label: 'Selection policy URL', type: 'url' },
];

export function EventFormPage({ client }: { client: Client }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;

    client
      .getEvent(id)
      .then((event) => {
        if (!active) return;
        setForm({
          name: event.name,
          competitionYear: String(event.competitionYear),
          division: event.division,
          section: event.section,
          eventDate: event.eventDate.slice(0, 10),
          venue: event.venue,
          startTime: event.startTime,
          endTime: event.endTime,
          firstWhistle: event.firstWhistle,
          lastWhistle: event.lastWhistle,
          registrationFeeCents: String(event.registrationFeeCents),
          courts: String(event.courts),
          rank1Min: String(event.rank1Min),
          rank2Min: String(event.rank2Min),
          rank3Min: String(event.rank3Min),
          playMinutes: String(event.playMinutes),
          changeoverMinutes: String(event.changeoverMinutes),
          minAge: String(event.minAge),
          maxAge: String(event.maxAge),
          policyUrl: event.policyUrl ?? '',
        });
      })
      .catch(() => setError('Could not load the event.'));

    return () => {
      active = false;
    };
  }, [client, id]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors([]);

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (key === 'policyUrl' && value === '') continue;
      payload[key] = NUMERIC.has(key) ? Number(value) : value;
    }

    try {
      if (id) {
        await client.updateEvent(id, payload as never);
      } else {
        await client.createEvent(payload as never);
      }
      navigate('/admin/events');
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fields ?? []);
        setError(err.status === 400 ? 'Please fix the highlighted fields.' : 'Could not save the event.');
      } else {
        setError('Could not save the event.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>{id ? 'Edit event' : 'New event'}</h1>
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={onSubmit} noValidate>
        {FIELDS.map((field) => {
          const invalid = fieldErrors.includes(field.name);
          return (
            <p key={field.name}>
              <label htmlFor={field.name}>{field.label}</label>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                value={form[field.name] ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, [field.name]: event.target.value }))}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${field.name}-error` : undefined}
              />
              {invalid ? (
                <span id={`${field.name}-error`} role="alert">
                  {field.label} is not valid.
                </span>
              ) : null}
            </p>
          );
        })}
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save event'}
        </button>
      </form>
    </section>
  );
}
