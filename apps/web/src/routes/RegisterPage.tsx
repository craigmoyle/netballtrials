import { useEffect, useRef, useState, type FormEvent } from 'react';
import { melbourneDateKey, POSITIONS, type EventDTO, type MemberAssociationDTO, type PublicEventDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';

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

const POSITION_LABELS: Record<string, string> = {
  GS: 'Goal shooter (GS)',
  GA: 'Goal attack (GA)',
  WA: 'Wing attack (WA)',
  C: 'Centre (C)',
  WD: 'Wing defence (WD)',
  GD: 'Goal defence (GD)',
  GK: 'Goal keeper (GK)',
};

const EMPTY = {
  playerFirstName: '',
  playerLastName: '',
  dateOfBirth: '',
  parentName: '',
  parentEmail: '',
  parentMobile: '',
  memberAssociation: '',
  rank1Position: '',
  rank2Position: '',
  rank3Position: '',
  optInExtraPositions: false,
  eligibilityConfirmed: false,
};

export function RegisterPage({ client, eventId, adminAssisted = false }: { client: Client; eventId: string; adminAssisted?: boolean }) {
  const [event, setEvent] = useState<PublicEventDTO | EventDTO | null>(null);
  const [associations, setAssociations] = useState<MemberAssociationDTO[] | null>(null);
  const [eventError, setEventError] = useState(false);
  const [associationError, setAssociationError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [simulationToken, setSimulationToken] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationCompleted, setSimulationCompleted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [eventRetry, setEventRetry] = useState(0);
  const [associationRetry, setAssociationRetry] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setEventError(false);
    (adminAssisted ? client.getEvent(eventId) : client.getPublicEvent(eventId))
      .then((loaded) => { if (active) setEvent(loaded); })
      .catch(() => { if (active) setEventError(true); });
    return () => { active = false; };
  }, [adminAssisted, client, eventId, eventRetry]);

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
    setSubmitError(null);
    setFieldErrors([]);
    if (!form.rank1Position) {
      setFieldErrors(['rank1Position']);
      return;
    }
    setBusy(true);

    try {
      const registration = {
        ...form,
        rank2Position: form.rank2Position || undefined,
        rank3Position: form.rank3Position || undefined,
      };
      if (adminAssisted) {
        await client.dayOfRegistration(eventId, registration);
        setSubmitted(true);
      } else {
        const acknowledgement = await client.register(eventId, registration);
        if (acknowledgement.simulationToken) setSimulationToken(acknowledgement.simulationToken);
        else setSubmitted(true);
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = (err as { message?: string }).message;
      if (adminAssisted && status === 409 && message === 'already_registered') {
        setSubmitError('This player is already registered. Contact the club if you need help.');
      } else if (adminAssisted && status === 409 && message === 'event_unavailable') {
        setSubmitError('Day-of registration is available only on the event date while check-in is open. Your details are still here.');
      } else if (adminAssisted && status === 503 && message === 'checkout_unavailable') {
        setSubmitError('Could not prepare or send the secure Checkout link. No payment has been taken. Your details are still here; try again.');
      } else if (status === 429) {
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

  async function simulateFakePayment() {
    if (!simulationToken) return;
    setSimulationError(null);
    setSimulationBusy(true);
    try {
      const result = await client.completeFakePayment(simulationToken);
      if (result.status === 'paid') setSimulationCompleted(true);
      else setSimulationError('Could not complete this test payment. No payment was taken. Contact the club if you need help.');
    } catch {
      setSimulationError('Could not complete this test payment. No payment was taken. Contact the club if you need help.');
    } finally {
      setSimulationBusy(false);
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
  const currency = 'currency' in event ? event.currency : 'aud';
  const fee = new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: currency.toUpperCase(),
  }).format(event.registrationFeeCents / 100);

  if (simulationToken) {
    return (
      <section className="public-page">
        <h1>Test payment simulation</h1>
        <p>Registration fee: {fee}</p>
        <p>No real payment will be taken. Do not enter card details.</p>
        {simulationCompleted ? (
          <>
            <p role="status">Test payment simulated. No payment was taken.</p>
            <p><a href={`/register/${encodeURIComponent(eventId)}/pending?session=${encodeURIComponent(simulationToken)}`}>View test ticket</a></p>
          </>
        ) : (
          <>
            {simulationError ? <p role="alert">{simulationError}</p> : null}
            <button type="button" onClick={() => void simulateFakePayment()} disabled={simulationBusy}>
              {simulationBusy ? 'Simulating payment...' : 'Simulate successful payment'}
            </button>
          </>
        )}
      </section>
    );
  }

  if (submitted) {
    return (
      <section className="public-page">
        <h1>{adminAssisted ? 'Checkout link sent' : 'Request received'}</h1>
        {adminAssisted
          ? <p>A secure Checkout link was sent to the parent or guardian. The registration remains pending; the player is not eligible for check-in or game planning until payment is confirmed.</p>
          : <p>Check the parent or guardian email for secure next steps. If no message arrives, check junk mail or contact the club.</p>}
      </section>
    );
  }

  return (
    <section className="public-page">
      <h1>{event.name}</h1>
      <p>{formatTrialDate(event.eventDate)} at {event.venue} · arrival {event.startTime} · first whistle {event.firstWhistle}</p>
      <p>Registration fee: {fee}</p>
      <p>Age range: {event.minAge}–{event.maxAge} years old as at 31 December {event.competitionYear}.</p>
      <p id="eligibility-introduction">
        The full eligibility criteria appear beside the confirmation at the end of this form.{' '}
        <a href="#eligibility-confirmation-summary">View eligibility criteria</a>.
      </p>
      <p>
        <a href={event.policyUrl ?? '#'} target="_blank" rel="noreferrer">Read the selection policy</a>
      </p>
      <p id="privacy-information">
        Privacy: these details are used for registration, payment, check-in and event messages. Parent contact details are not shown to volunteers. The app removes or anonymises personal details 12 calendar months after the event date.{' '}
        <a href="mailto:chisholmnetball@gmail.com?subject=Privacy%20question">Contact the club with privacy questions</a>.
      </p>
      <nav className="registration-sections" aria-label="Registration sections">
        <ol>
          <li><a href="#player-details">Player details</a></li>
          <li><a href="#parent-details">Parent or guardian details</a></li>
          <li><a href="#position-preferences">Position preferences</a></li>
          <li><a href="#eligibility-confirmation">Eligibility confirmation</a></li>
        </ol>
      </nav>

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
        <fieldset id="player-details" className="form-group">
          <legend>Player details</legend>
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
            <label htmlFor="memberAssociation">Member association</label>
            <select id="memberAssociation" value={form.memberAssociation} disabled={!associations || associations.length === 0} aria-invalid={invalid('memberAssociation') || undefined} aria-describedby={describedBy('memberAssociation')} onChange={(e) => set('memberAssociation', e.target.value)}>
              <option value="">{!associations ? 'Loading associations...' : associations.length ? 'Choose an association' : 'No active associations available'}</option>
              {associations?.map((association) => <option key={association.id} value={association.name}>{association.name}</option>)}
            </select>
            {invalid('memberAssociation') ? <span id="memberAssociation-error">Choose an active member association.</span> : null}
            {associations?.length === 0 ? <span>No active associations are available. Contact the club before registering.</span> : null}
          </p>
        </fieldset>

        <fieldset id="parent-details" className="form-group">
          <legend>Parent or guardian details</legend>
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
        </fieldset>

        <fieldset id="position-preferences" className="form-group">
          <legend>Position preferences</legend>
          <p>Choose up to three ranked positions. The first choice is required; the other two are optional.</p>
          {(['rank1Position', 'rank2Position', 'rank3Position'] as const).map((field, index) => (
            <p key={field}>
              <label htmlFor={field}>{['First', 'Second', 'Third'][index]} position{index === 0 ? ' (required)' : ' (optional)'}</label>
              <select id={field} required={index === 0} value={form[field]} aria-invalid={invalid(field) || undefined} aria-describedby={describedBy(field)} onChange={(e) => set(field, e.target.value)}>
                <option value="">{index === 0 ? 'Choose a first position' : 'No preference'}</option>
                {POSITIONS.map((position) => (
                  <option key={position} value={position} disabled={index > 0 && [form.rank1Position, form.rank2Position].slice(0, index).includes(position)}>
                    {POSITION_LABELS[position]}
                  </option>
                ))}
              </select>
              {invalid(field) ? <span id={`${field}-error`}>{index === 0 ? 'Choose a first position for the player.' : 'Choose a different position or leave this rank blank.'}</span> : null}
            </p>
          ))}
          <p>
            <label htmlFor="optInExtraPositions">
              <input id="optInExtraPositions" type="checkbox" checked={form.optInExtraPositions} onChange={(e) => set('optInExtraPositions', e.target.checked)} />{' '}
              I am open to extra games outside my chosen positions.
            </label>
          </p>
        </fieldset>

        <fieldset id="eligibility-confirmation" className="form-group">
          <legend>Eligibility confirmation</legend>
          <p id="eligibility-confirmation-summary">
            The player must be {event.minAge}–{event.maxAge} years old as at 31 December {event.competitionYear}, be a permanent player in a domestic or representative competition at a Chisholm Region member association, and have played at least six association games between 1 January {event.competitionYear} and the day before the trial.
          </p>
          {invalid('eligibilityConfirmed') ? <p id="eligibilityConfirmed-error">Confirm the player meets the eligibility requirements.</p> : null}
          <p>
            <label htmlFor="eligibilityConfirmed">
              <input id="eligibilityConfirmed" type="checkbox" checked={form.eligibilityConfirmed} aria-invalid={invalid('eligibilityConfirmed') || undefined} aria-describedby={['eligibility-confirmation-summary', describedBy('eligibilityConfirmed')].filter(Boolean).join(' ')} onChange={(e) => set('eligibilityConfirmed', e.target.checked)} />{' '}
              I confirm the player meets these eligibility requirements.
            </label>
          </p>
        </fieldset>

        <button type="submit" disabled={busy || !associations || associations.length === 0}>
          {busy ? (adminAssisted ? 'Sending payment link...' : 'Submitting...') : adminAssisted ? 'Send payment link' : 'Submit registration'}
        </button>
      </form>
    </section>
  );
}
