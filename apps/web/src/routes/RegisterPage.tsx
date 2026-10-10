import { useEffect, useRef, useState, type FormEvent } from 'react';
import { melbourneDateKey, POSITIONS, type MemberAssociationDTO, type PublicEventDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

const FIELD_LABELS: Record<string, string> = {
  playerFirstName: 'Player first name',
  playerLastName: 'Player last name',
  dateOfBirth: 'Player date of birth',
  parentName: 'Parent or guardian name',
  parentEmail: 'Parent or guardian email',
  parentMobile: 'Parent or guardian mobile',
  memberAssociation: 'Member association',
  rank1Position: 'First position',
  rank2Position: 'Second position',
  rank3Position: 'Third position',
  eligibilityConfirmed: 'Eligibility confirmation',
};

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
  const [associations, setAssociations] = useState<MemberAssociationDTO[] | null>(null);
  const [eventError, setEventError] = useState(false);
  const [associationError, setAssociationError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [eventRetry, setEventRetry] = useState(0);
  const [associationRetry, setAssociationRetry] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setEventError(false);
    client
      .getPublicEvent(eventId)
      .then((loaded) => { if (active) setEvent(loaded); })
      .catch(() => { if (active) setEventError(true); });
    return () => { active = false; };
  }, [client, eventId, eventRetry]);

  useEffect(() => {
    let active = true;
    setAssociationError(false);
    client
      .listPublicAssociations()
      .then((loaded) => { if (active) setAssociations(loaded.filter((association) => association.active)); })
      .catch(() => { if (active) setAssociationError(true); });
    return () => { active = false; };
  }, [client, associationRetry]);

  useEffect(() => {
    if (fieldErrors.length > 0) errorSummary.current?.focus();
  }, [fieldErrors]);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function invalid(field: string): boolean {
    return fieldErrors.includes(field);
  }

  function describedBy(field: string): string | undefined {
    return invalid(field) ? `${field}-error` : undefined;
  }

  async function onSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    setBusy(true);
    setSubmitError(null);
    setFieldErrors([]);

    try {
      await client.register(eventId, {
        ...form,
        rank2Position: form.rank2Position || undefined,
        rank3Position: form.rank3Position || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) {
        setSubmitError('Too many attempts. Wait a little while, then try again. Your details are still here.');
      } else if (status === 400) {
        setFieldErrors((err as { fields?: string[] }).fields ?? []);
      } else {
        setSubmitError('Could not start registration. Your details are still here. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (eventError) {
    return (
      <section className="public-page">
        <h1>Could not load the trial</h1>
        <p role="alert">Check your connection and try again.</p>
        <button type="button" onClick={() => setEventRetry((count) => count + 1)}>Try again</button>
      </section>
    );
  }
  if (!event) return <p role="status">Loading trial details...</p>;
  if (submitted) {
    return (
      <section className="public-page">
        <h1>Request received</h1>
        <p>Check the parent or guardian email for secure next steps. If no message arrives, check junk mail or contact the club.</p>
      </section>
    );
  }

  const fee = new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: event.currency.toUpperCase(),
  }).format(event.registrationFeeCents / 100);

  return (
    <section className="public-page">
      <h1>{event.name}</h1>
      <p>{event.eventDate.slice(0, 10)} at {event.venue} · arrival {event.startTime} · first whistle {event.firstWhistle}</p>
      <p>Registration fee: {fee}</p>
      <p id="eligibility-statement">
        To be eligible, the player must be a permanent player in a domestic or representative competition at a Chisholm Region member association and must have played at least six association games between 1 January {event.competitionYear} and the day before the trial.
      </p>
      <p>
        <a href={event.policyUrl ?? '#'} target="_blank" rel="noreferrer">Read the selection policy</a>
      </p>
      <p id="privacy-information">
        Privacy: these details are used for registration, payment, check-in and event messages. Parent contact details are not shown to volunteers. The app removes or anonymises personal details 12 calendar months after the event date.{' '}
        <a href="mailto:chisholmnetball@gmail.com?subject=Privacy%20question">Contact the club with privacy questions</a>.
      </p>

      {fieldErrors.length > 0 ? (
        <div ref={errorSummary} role="alert" aria-labelledby="registration-errors-title" tabIndex={-1} className="error-summary">
          <h2 id="registration-errors-title">Your registration needs changes</h2>
          <ul>
            {fieldErrors.map((field) => (
              <li key={field}><a href={`#${field}`}>{FIELD_LABELS[field] ?? field}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
      {submitError ? <p role="alert">{submitError}</p> : null}
      {associationError ? (
        <p role="alert">
          Member associations could not be loaded.{' '}
          <button type="button" onClick={() => setAssociationRetry((count) => count + 1)}>Retry association list</button>
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <p>
          <label htmlFor="playerFirstName">Player first name</label>
          <input id="playerFirstName" autoComplete="given-name" value={form.playerFirstName} aria-invalid={invalid('playerFirstName') || undefined} aria-describedby={describedBy('playerFirstName')} onChange={(e) => set('playerFirstName', e.target.value)} />
          {invalid('playerFirstName') ? <span id="playerFirstName-error">Enter the player's first name.</span> : null}
        </p>
        <p>
          <label htmlFor="playerLastName">Player last name</label>
          <input id="playerLastName" autoComplete="family-name" value={form.playerLastName} aria-invalid={invalid('playerLastName') || undefined} aria-describedby={describedBy('playerLastName')} onChange={(e) => set('playerLastName', e.target.value)} />
          {invalid('playerLastName') ? <span id="playerLastName-error">Enter the player's last name.</span> : null}
        </p>
        <p>
          <label htmlFor="dateOfBirth">Player date of birth</label>
          <input id="dateOfBirth" type="date" max={melbourneDateKey(new Date())} value={form.dateOfBirth} aria-invalid={invalid('dateOfBirth') || undefined} aria-describedby={describedBy('dateOfBirth')} onChange={(e) => set('dateOfBirth', e.target.value)} />
          {invalid('dateOfBirth') ? <span id="dateOfBirth-error">Enter a valid date of birth.</span> : null}
        </p>
        <p>
          <label htmlFor="parentName">Parent or guardian name</label>
          <input id="parentName" autoComplete="name" value={form.parentName} aria-invalid={invalid('parentName') || undefined} aria-describedby={describedBy('parentName')} onChange={(e) => set('parentName', e.target.value)} />
          {invalid('parentName') ? <span id="parentName-error">Enter a parent or guardian name.</span> : null}
        </p>
        <p>
          <label htmlFor="parentEmail">Parent or guardian email</label>
          <input id="parentEmail" type="email" autoComplete="email" value={form.parentEmail} aria-invalid={invalid('parentEmail') || undefined} aria-describedby={describedBy('parentEmail')} onChange={(e) => set('parentEmail', e.target.value)} />
          {invalid('parentEmail') ? <span id="parentEmail-error">Enter a valid email address.</span> : null}
        </p>
        <p>
          <label htmlFor="parentMobile">Parent or guardian mobile</label>
          <input id="parentMobile" type="tel" autoComplete="tel" value={form.parentMobile} aria-invalid={invalid('parentMobile') || undefined} aria-describedby={describedBy('parentMobile')} onChange={(e) => set('parentMobile', e.target.value)} />
          {invalid('parentMobile') ? <span id="parentMobile-error">Enter a parent or guardian mobile number.</span> : null}
        </p>
        <p>
          <label htmlFor="memberAssociation">Member association</label>
          <select id="memberAssociation" value={form.memberAssociation} disabled={!associations || associations.length === 0} aria-invalid={invalid('memberAssociation') || undefined} aria-describedby={describedBy('memberAssociation')} onChange={(e) => set('memberAssociation', e.target.value)}>
            <option value="">{!associations ? 'Loading associations...' : associations.length ? 'Choose an association' : 'No active associations available'}</option>
            {associations?.map((association) => <option key={association.id} value={association.name}>{association.name}</option>)}
          </select>
          {invalid('memberAssociation') ? <span id="memberAssociation-error">Choose an active member association.</span> : null}
          {associations?.length === 0 ? <span>No active associations are available. Contact the club before registering.</span> : null}
        </p>
        {(['rank1Position', 'rank2Position', 'rank3Position'] as const).map((field, index) => (
          <p key={field}>
            <label htmlFor={field}>{['First', 'Second', 'Third'][index]} position{index > 0 ? ' (optional)' : ''}</label>
            <select id={field} value={form[field]} aria-invalid={invalid(field) || undefined} aria-describedby={describedBy(field)} onChange={(e) => set(field, e.target.value)}>
              {index > 0 ? <option value="">No preference</option> : null}
              {POSITIONS.map((position) => (
                <option key={position} value={position} disabled={index > 0 && [form.rank1Position, form.rank2Position].slice(0, index).includes(position)}>
                  {position}
                </option>
              ))}
            </select>
            {invalid(field) ? <span id={`${field}-error`}>Choose a different position or leave this rank blank.</span> : null}
          </p>
        ))}
        <p>
          <label htmlFor="optInExtraPositions">
            <input id="optInExtraPositions" type="checkbox" checked={form.optInExtraPositions} onChange={(e) => set('optInExtraPositions', e.target.checked)} />{' '}
            I am open to extra games outside my chosen positions.
          </label>
        </p>
        {invalid('eligibilityConfirmed') ? <p id="eligibilityConfirmed-error">Confirm the player meets the eligibility requirements.</p> : null}
        <p>
          <label htmlFor="eligibilityConfirmed">
            <input id="eligibilityConfirmed" type="checkbox" checked={form.eligibilityConfirmed} aria-invalid={invalid('eligibilityConfirmed') || undefined} aria-describedby={describedBy('eligibilityConfirmed')} onChange={(e) => set('eligibilityConfirmed', e.target.checked)} />{' '}
            I confirm the player meets the eligibility requirements above.
          </label>
        </p>
        <button type="submit" disabled={busy || !associations || associations.length === 0}>
          {busy ? 'Submitting...' : 'Continue to payment'}
        </button>
      </form>
    </section>
  );
}
