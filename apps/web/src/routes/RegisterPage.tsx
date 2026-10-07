import { useEffect, useState, type FormEvent } from 'react';
import type { PublicEventDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

const EMPTY = {
  playerFirstName: '',
  playerLastName: '',
  dateOfBirth: '',
  parentName: '',
  parentEmail: '',
  parentMobile: '',
  memberAssociation: '',
  rank1Position: 'GS',
  rank2Position: '',
  rank3Position: '',
  optInExtraPositions: false,
  eligibilityConfirmed: false,
};

export function RegisterPage({ client, eventId }: { client: Client; eventId: string }) {
  const [event, setEvent] = useState<PublicEventDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    let active = true;
    client
      .getPublicEvent(eventId)
      .then((loaded) => {
        if (active) setEvent(loaded);
      })
      .catch(() => {
        if (active) setError('Could not load the trial.');
      });
    return () => {
      active = false;
    };
  }, [client, eventId]);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function onSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    setBusy(true);
    setError(null);
    setDuplicate(false);
    setFieldErrors([]);

    try {
      const response = await client.register(eventId, {
        ...form,
        rank2Position: form.rank2Position || undefined,
        rank3Position: form.rank3Position || undefined,
      });
      window.location.assign(response.checkoutUrl);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        setDuplicate(true);
      } else if (status === 400) {
        setFieldErrors((err as { fields?: string[] }).fields ?? []);
      } else {
        setError('Could not start registration. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (duplicate) {
    return (
      <p role="alert">
        Check your email or contact the club if you think this is a mistake.
      </p>
    );
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!event) {
    return <p>Loading...</p>;
  }

  return (
    <section>
      <h1>{event.name}</h1>
      <p>
        {event.eventDate.slice(0, 10)} at {event.venue}
      </p>
      <p>Registration fee: ${(event.registrationFeeCents / 100).toFixed(2)} AUD</p>
      {fieldErrors.length > 0 ? (
        <p role="alert">Please fix the highlighted fields: {fieldErrors.join(', ')}</p>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <p>
          <label htmlFor="playerFirstName">Player first name</label>
          <input id="playerFirstName" value={form.playerFirstName} onChange={(e) => set('playerFirstName', e.target.value)} autoComplete="given-name" />
        </p>
        <p>
          <label htmlFor="playerLastName">Player last name</label>
          <input id="playerLastName" value={form.playerLastName} onChange={(e) => set('playerLastName', e.target.value)} autoComplete="family-name" />
        </p>
        <p>
          <label htmlFor="dateOfBirth">Player date of birth</label>
          <input id="dateOfBirth" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
        </p>
        <p>
          <label htmlFor="parentName">Parent or guardian name</label>
          <input id="parentName" value={form.parentName} onChange={(e) => set('parentName', e.target.value)} autoComplete="name" />
        </p>
        <p>
          <label htmlFor="parentEmail">Parent or guardian email</label>
          <input id="parentEmail" type="email" value={form.parentEmail} onChange={(e) => set('parentEmail', e.target.value)} autoComplete="email" />
        </p>
        <p>
          <label htmlFor="parentMobile">Parent or guardian mobile</label>
          <input id="parentMobile" type="tel" value={form.parentMobile} onChange={(e) => set('parentMobile', e.target.value)} autoComplete="tel" />
        </p>
        <p>
          <label htmlFor="memberAssociation">Member association</label>
          <input id="memberAssociation" value={form.memberAssociation} onChange={(e) => set('memberAssociation', e.target.value)} />
        </p>
        {(['rank1Position', 'rank2Position', 'rank3Position'] as const).map((field, index) => (
          <p key={field}>
            <label htmlFor={field}>{['First', 'Second', 'Third'][index]} position{index > 0 ? ' (optional)' : ''}</label>
            <select id={field} value={form[field]} onChange={(e) => set(field, e.target.value)}>
              {index > 0 ? <option value="">No preference</option> : null}
              {POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </select>
          </p>
        ))}
        <p>
          <label>
            <input type="checkbox" checked={form.optInExtraPositions} onChange={(e) => set('optInExtraPositions', e.target.checked)} /> I am open to extra games outside my chosen positions
          </label>
        </p>
        <p>
          <label>
            <input type="checkbox" checked={form.eligibilityConfirmed} onChange={(e) => set('eligibilityConfirmed', e.target.checked)} /> I confirm the eligibility requirements and have read the{' '}
          </label>
          <a href={event.policyUrl ?? '#'}>selection policy</a>
        </p>
        <button type="submit" disabled={busy}>
          {busy ? 'Starting...' : 'Register and pay'}
        </button>
      </form>
    </section>
  );
}
