import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useLocation } from 'react-router-dom';
import { melbourneDateKey, POSITIONS, type EventDTO, type MemberAssociationDTO, type PublicEventDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { formatFee } from '../formatFee';
import { formatTrialDate } from '../formatTrialDate';
import { useUnsavedSignOut } from '../useUnsavedSignOut';

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

const REGISTRATION_SECTIONS = [
  ['player-details', 'Player'],
  ['parent-details', 'Parent / guardian'],
  ['position-preferences', 'Positions'],
  ['eligibility-confirmation', 'Eligibility'],
] as const;
type RegistrationSectionId = (typeof REGISTRATION_SECTIONS)[number][0];

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

const REQUIRED_FIELDS: readonly (keyof typeof EMPTY)[] = [
  'playerFirstName', 'playerLastName', 'dateOfBirth', 'parentName', 'parentEmail',
  'parentMobile', 'memberAssociation', 'rank1Position', 'eligibilityConfirmed',
];
const REGISTRATION_DRAFT_TTL_MS = 60 * 60 * 1000;

type RegistrationDraft = { form: typeof EMPTY; restored: boolean; storageError: boolean };

function registrationDraftKey(eventId: string): string {
  return `chisholm-registration-draft:public:v1:${encodeURIComponent(eventId)}`;
}

function isRegistrationDraftForm(value: unknown): value is typeof EMPTY {
  if (!value || typeof value !== 'object') return false;
  const form = value as Record<string, unknown>;
  const textFields = ['playerFirstName', 'playerLastName', 'dateOfBirth', 'parentName', 'parentEmail', 'parentMobile', 'memberAssociation'];
  const positionFields = ['rank1Position', 'rank2Position', 'rank3Position'];
  return textFields.every((field) => typeof form[field] === 'string') &&
    positionFields.every((field) => typeof form[field] === 'string' &&
      (form[field] === '' || POSITIONS.includes(form[field] as (typeof POSITIONS)[number]))) &&
    typeof form.optInExtraPositions === 'boolean' && typeof form.eligibilityConfirmed === 'boolean';
}

function removeRegistrationDraft(eventId: string): boolean {
  try {
    window.sessionStorage.removeItem(registrationDraftKey(eventId));
    return true;
  } catch {
    return false;
  }
}

function loadRegistrationDraft(eventId: string): RegistrationDraft {
  const key = registrationDraftKey(eventId);
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(key);
  } catch {
    return { form: EMPTY, restored: false, storageError: true };
  }
  if (!raw) return { form: EMPTY, restored: false, storageError: false };

  try {
    const draft = JSON.parse(raw) as { version?: unknown; savedAt?: unknown; form?: unknown };
    const now = Date.now();
    if (draft.version !== 1 || typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt) ||
      draft.savedAt > now || now - draft.savedAt >= REGISTRATION_DRAFT_TTL_MS || !isRegistrationDraftForm(draft.form)) {
      return { form: EMPTY, restored: false, storageError: !removeRegistrationDraft(eventId) };
    }
    return { form: draft.form, restored: true, storageError: false };
  } catch {
    return { form: EMPTY, restored: false, storageError: !removeRegistrationDraft(eventId) };
  }
}

export function RegisterPage({ client, eventId, adminAssisted = false }: { client: Client; eventId: string; adminAssisted?: boolean }) {
  const [event, setEvent] = useState<PublicEventDTO | EventDTO | null>(null);
  const [associations, setAssociations] = useState<MemberAssociationDTO[] | null>(null);
  const [eventError, setEventError] = useState(false);
  const [associationError, setAssociationError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { hash } = useLocation();
  const [submitted, setSubmitted] = useState(false);
  const [simulationToken, setSimulationToken] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationCompleted, setSimulationCompleted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [eventRetry, setEventRetry] = useState(0);
  const [associationRetry, setAssociationRetry] = useState(0);
  const [initialDraft] = useState(() => adminAssisted
    ? { form: EMPTY, restored: false, storageError: false }
    : loadRegistrationDraft(eventId));
  const [form, setForm] = useState(initialDraft.form);
  const lastStoredForm = useRef(initialDraft.form);
  const [draftRestored, setDraftRestored] = useState(initialDraft.restored);
  const [draftStorageError, setDraftStorageError] = useState(initialDraft.storageError);
  const [activeSection, setActiveSection] = useState<RegistrationSectionId>('player-details');
  const errorSummary = useRef<HTMLDivElement>(null);
  const simulationHeading = useRef<HTMLHeadingElement>(null);
  const completionHeading = useRef<HTMLHeadingElement>(null);
  const promptedLocation = useRef<string | null>(null);
  const hasUnsavedDetails = (Object.keys(EMPTY) as (keyof typeof EMPTY)[])
    .some((key) => form[key] !== EMPTY[key]);
  const shouldWarnBeforeLeaving = hasUnsavedDetails && !submitted && !simulationCompleted;
  useUnsavedSignOut(adminAssisted && shouldWarnBeforeLeaving, 'Day-of registration details are only held while this page is open. Leave and lose them?');
  const blocker = useBlocker(({ currentLocation, nextLocation }) => shouldWarnBeforeLeaving &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));

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

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptedLocation.current = null;
      return;
    }
    const destination = `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`;
    if (promptedLocation.current === destination) return;
    promptedLocation.current = destination;
    const message = simulationToken && !simulationCompleted
      ? 'The test payment simulation is not complete. Leave this page?'
      : adminAssisted
        ? 'Day-of registration details are only held while this page is open. Leave and lose them?'
        : draftStorageError
          ? 'Your browser could not save the draft. Leave and lose the details?'
          : 'A draft is saved in this tab for up to 1 hour after your last change. Closing this tab clears it. Leave this page?';
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [adminAssisted, blocker, draftStorageError, simulationToken, simulationCompleted]);

  useEffect(() => {
    if (!shouldWarnBeforeLeaving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [shouldWarnBeforeLeaving]);

  useEffect(() => {
    if (adminAssisted) return;
    if (!hasUnsavedDetails || submitted || simulationToken) {
      setDraftStorageError(!removeRegistrationDraft(eventId));
      return;
    }
    if (lastStoredForm.current === form) return;
    lastStoredForm.current = form;
    try {
      window.sessionStorage.setItem(registrationDraftKey(eventId), JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        form,
      }));
      setDraftStorageError(false);
    } catch {
      removeRegistrationDraft(eventId);
      setDraftStorageError(true);
    }
  }, [adminAssisted, eventId, form, hasUnsavedDetails, submitted, simulationToken]);

  useEffect(() => {
    if (!event || eventError || submitted || simulationToken || typeof IntersectionObserver === 'undefined') return;
    const sections = REGISTRATION_SECTIONS
      .map(([id]) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      if (document.documentElement.scrollHeight > window.innerHeight &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1) {
        setActiveSection('eligibility-confirmation');
        return;
      }
      const hashId = hash.slice(1);
      const hashSectionId = REGISTRATION_SECTIONS.find(([id]) => id === hashId)?.[0] ??
        (hashId === 'eligibility-confirmation-summary' ? 'eligibility-confirmation' : null);
      const hashSection = hashSectionId ? document.getElementById(hashSectionId) : null;
      const hashBounds = hashSection?.getBoundingClientRect();
      if (hashSectionId && hashBounds && hashBounds.top < window.innerHeight && hashBounds.bottom > 0) {
        setActiveSection(hashSectionId);
        return;
      }
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible && REGISTRATION_SECTIONS.some(([id]) => id === visible.target.id)) {
        setActiveSection(visible.target.id as RegistrationSectionId);
      }
    }, { rootMargin: '-10% 0px -70% 0px' });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [event, eventError, submitted, simulationToken, hash]);

  useEffect(() => {
    if (!event || !hash || eventError || submitted || simulationToken) return;
    const targetId = hash.slice(1);
    const sectionId = REGISTRATION_SECTIONS.find(([id]) => id === targetId)?.[0] ??
      (targetId === 'eligibility-confirmation-summary' ? 'eligibility-confirmation' : null);
    if (!sectionId) return;
    setActiveSection(sectionId);
    document.getElementById(targetId)?.scrollIntoView?.({ block: 'start' });
  }, [event, eventError, hash, submitted, simulationToken]);

  useEffect(() => {
    if (simulationToken) simulationHeading.current?.focus();
  }, [simulationToken]);

  useEffect(() => {
    if (submitted) completionHeading.current?.focus();
  }, [submitted]);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setDraftRestored(false);
    setForm((previous) => previous[key] === value ? previous : { ...previous, [key]: value });
  }

  function clearSavedDraft() {
    if (!window.confirm('Clear the saved draft and all entered details from this tab?')) return;
    setForm(EMPTY);
    setDraftRestored(false);
    setFieldErrors([]);
    setSubmitError(null);
    setDraftStorageError(!removeRegistrationDraft(eventId));
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
    const missingFields = REQUIRED_FIELDS.filter((field) => {
      const value = form[field];
      return typeof value === 'string' ? value.trim().length === 0 : !value;
    });
    if (missingFields.length > 0) {
      setFieldErrors(missingFields);
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
  const fee = formatFee(event.registrationFeeCents, currency);

  if (simulationToken) {
    return (
      <section className="public-page">
        <h1 ref={simulationHeading} tabIndex={-1}>Test payment simulation</h1>
        {draftStorageError ? <p role="alert">This browser could not save or clear a draft. Keep this tab open; closing or refreshing may lose your details.</p> : null}
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
        <h1 ref={completionHeading} tabIndex={-1}>{adminAssisted ? 'Checkout link sent' : 'Request received'}</h1>
        {!adminAssisted && draftStorageError ? <p role="alert">This browser could not confirm the draft was cleared. Close this tab to clear any saved details.</p> : null}
        {adminAssisted
          ? <p>A secure Checkout link was sent to the parent or guardian. The registration remains pending; the player is not eligible for check-in or game planning until payment is confirmed.</p>
          : <p>Check the parent or guardian email for the secure Checkout link. If no message arrives, check junk mail or contact the club.</p>}
      </section>
    );
  }

  return (
    <section className="public-page registration-page">
      <h1>{event.name}</h1>
      <p>{formatTrialDate(event.eventDate)} at {event.venue} · arrival time {event.startTime} · start time {event.gameStartTime}</p>
      <p>Registration fee: {fee}</p>
      <section className="registration-eligibility-summary" aria-labelledby="registration-eligibility-heading">
        <div className="registration-eligibility-heading">
          <h2 id="registration-eligibility-heading">Eligibility at a glance</h2>
          <Link to="#eligibility-confirmation-summary">View full criteria</Link>
        </div>
        <ul>
          <li>Age: {event.minAge}–{event.maxAge} on 31 December {event.competitionYear}.</li>
          <li>Permanent player in a domestic or representative competition at a Chisholm Region member association.</li>
          <li>At least six association games from 1 January {event.competitionYear} to the day before the trial.</li>
        </ul>
      </section>
      <p className="registration-privacy-note">
        {adminAssisted
          ? 'Volunteers do not see parent contact details.'
          : 'Your draft is saved in this tab for up to 1 hour after your last change and restored if you reload. Anyone with access to this tab can see it; closing the tab clears it.'}
      </p>
      {draftRestored ? <p role="status">Draft restored from this tab.</p> : null}
      {draftStorageError ? <p role="alert">This browser could not save or clear a draft. Keep this tab open; closing or refreshing may lose your details.</p> : null}
      <nav className="registration-sections" aria-label="Registration sections">
        <ol>
          {REGISTRATION_SECTIONS.map(([id, label]) => (
            <li key={id}><Link to={`#${id}`} aria-current={activeSection === id ? 'location' : undefined}>{label}</Link></li>
          ))}
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

      <form className="registration-form" onSubmit={onSubmit} noValidate>
        <fieldset id="player-details" className="form-group">
          <legend>Player details</legend>
          <p>
            <label htmlFor="playerFirstName">Player first name (required)</label>
            <input id="playerFirstName" required autoComplete="given-name" value={form.playerFirstName} aria-invalid={invalid('playerFirstName') || undefined} aria-describedby={describedBy('playerFirstName')} onChange={(e) => set('playerFirstName', e.target.value)} />
            {invalid('playerFirstName') ? <span id="playerFirstName-error">Enter the player's first name.</span> : null}
          </p>
          <p>
            <label htmlFor="playerLastName">Player last name (required)</label>
            <input id="playerLastName" required autoComplete="family-name" value={form.playerLastName} aria-invalid={invalid('playerLastName') || undefined} aria-describedby={describedBy('playerLastName')} onChange={(e) => set('playerLastName', e.target.value)} />
            {invalid('playerLastName') ? <span id="playerLastName-error">Enter the player's last name.</span> : null}
          </p>
          <p>
            <label htmlFor="dateOfBirth">Player date of birth (required)</label>
            <input id="dateOfBirth" required type="date" max={melbourneDateKey(new Date())} value={form.dateOfBirth} aria-invalid={invalid('dateOfBirth') || undefined} aria-describedby={describedBy('dateOfBirth')} onChange={(e) => set('dateOfBirth', e.target.value)} />
            {invalid('dateOfBirth') ? <span id="dateOfBirth-error">Enter a valid date of birth.</span> : null}
          </p>
          <p>
            <label htmlFor="memberAssociation">Member association (required)</label>
            <select id="memberAssociation" required value={form.memberAssociation} disabled={!associations || associations.length === 0} aria-invalid={invalid('memberAssociation') || undefined} aria-describedby={describedBy('memberAssociation')} onChange={(e) => set('memberAssociation', e.target.value)}>
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
            <label htmlFor="parentName">Parent or guardian name (required)</label>
            <input id="parentName" required autoComplete="name" value={form.parentName} aria-invalid={invalid('parentName') || undefined} aria-describedby={describedBy('parentName')} onChange={(e) => set('parentName', e.target.value)} />
            {invalid('parentName') ? <span id="parentName-error">Enter a parent or guardian name.</span> : null}
          </p>
          <p>
            <label htmlFor="parentEmail">Parent or guardian email (required)</label>
            <input id="parentEmail" required type="email" autoComplete="email" value={form.parentEmail} aria-invalid={invalid('parentEmail') || undefined} aria-describedby={describedBy('parentEmail')} onChange={(e) => set('parentEmail', e.target.value)} />
            {invalid('parentEmail') ? <span id="parentEmail-error">Enter a valid email address.</span> : null}
          </p>
          <p>
            <label htmlFor="parentMobile">Parent or guardian mobile (required)</label>
            <input id="parentMobile" required type="tel" autoComplete="tel" value={form.parentMobile} aria-invalid={invalid('parentMobile') || undefined} aria-describedby={describedBy('parentMobile')} onChange={(e) => set('parentMobile', e.target.value)} />
            {invalid('parentMobile') ? <span id="parentMobile-error">Enter a parent or guardian mobile number.</span> : null}
          </p>
        </fieldset>

        <fieldset id="position-preferences" className="form-group">
          <legend>Position preferences</legend>
          <p>Choose up to three ranked positions. The first choice is required; the other two are optional.</p>
          <p>Each position can be chosen once. Clear a lower-ranked choice before moving it higher.</p>
          {(['rank1Position', 'rank2Position', 'rank3Position'] as const).map((field, index) => (
            <p key={field}>
              <label htmlFor={field}>{['First', 'Second', 'Third'][index]} position{index === 0 ? ' (required)' : ' (optional)'}</label>
              <select id={field} required={index === 0} value={form[field]} aria-invalid={invalid(field) || undefined} aria-describedby={describedBy(field)} onChange={(e) => set(field, e.target.value)}>
                <option value="">{index === 0 ? 'Choose a first position' : 'No preference'}</option>
                {POSITIONS.map((position) => (
                  <option
                    key={position}
                    value={position}
                    disabled={(['rank1Position', 'rank2Position', 'rank3Position'] as const)
                      .some((rank) => rank !== field && form[rank] === position)}
                  >
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
          <ul id="eligibility-confirmation-summary" className="eligibility-criteria">
            <li>The player must be {event.minAge}–{event.maxAge} years old as at 31 December {event.competitionYear}.</li>
            <li>The player must be a permanent player in a domestic or representative competition at a Chisholm Region member association.</li>
            <li>The player must have played at least six association games between 1 January {event.competitionYear} and the day before the trial.</li>
          </ul>
          {invalid('eligibilityConfirmed') ? <p id="eligibilityConfirmed-error">Confirm the player meets the eligibility requirements.</p> : null}
          <p>
            <label htmlFor="eligibilityConfirmed">
              <input id="eligibilityConfirmed" required type="checkbox" checked={form.eligibilityConfirmed} aria-invalid={invalid('eligibilityConfirmed') || undefined} aria-describedby={['eligibility-confirmation-summary', describedBy('eligibilityConfirmed')].filter(Boolean).join(' ')} onChange={(e) => set('eligibilityConfirmed', e.target.checked)} />{' '}
              I confirm the player meets these eligibility requirements (required).
            </label>
          </p>
        </fieldset>

        {event.policyUrl ? (
          <p><a href={event.policyUrl} target="_blank" rel="noreferrer">Selection policy (new tab)</a></p>
        ) : null}
        <details id="privacy-information" className="registration-privacy">
          <summary>Privacy details</summary>
          <p>These details are used for registration, payment, check-in and event messages.</p>
          <p>Parent contact details are not shown to volunteers.</p>
          <p>The app removes or anonymises personal details 12 calendar months after the event date.</p>
          <p><a href="mailto:chisholmnetball@gmail.com?subject=Privacy%20question">Contact the club with privacy questions</a>.</p>
          {!adminAssisted && hasUnsavedDetails ? (
            <p><button type="button" className="button-secondary" onClick={clearSavedDraft}>Clear saved draft and form</button></p>
          ) : null}
        </details>
        <button type="submit" disabled={busy || !associations || associations.length === 0}>
          {busy ? (adminAssisted ? 'Sending payment link...' : 'Submitting...') : adminAssisted ? 'Send payment link' : 'Submit registration'}
        </button>
      </form>
    </section>
  );
}
