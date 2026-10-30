import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { POSITIONS, type ParentRegistrationDTO, type ParentRegistrationUpdateDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { formatFee } from '../formatFee';
import { formatTrialDate } from '../formatTrialDate';

type Mode = 'checking' | 'request' | 'sent' | 'confirm' | 'portal';
type RegistrationDraft = Required<ParentRegistrationUpdateDTO>;

function draftFrom(registration: ParentRegistrationDTO): RegistrationDraft {
  return {
    playerFirstName: registration.playerFirstName,
    playerLastName: registration.playerLastName,
    parentName: registration.parentName,
    parentMobile: registration.parentMobile,
    rank1Position: registration.rank1Position,
    rank2Position: registration.rank2Position,
    rank3Position: registration.rank3Position,
    optInExtraPositions: registration.optInExtraPositions,
  };
}

function checkoutClosed(registration: ParentRegistrationDTO): boolean {
  return registration.status === 'EXPIRED' || registration.status === 'FAILED' ||
    (registration.status === 'PENDING' && new Date(registration.expiresAt).getTime() <= Date.now());
}

function registrationStatus(registration: ParentRegistrationDTO): string {
  if (registration.status === 'PAID') return 'Complete — payment confirmed.';
  if (registration.status === 'WITHDRAWN') return 'Withdrawn. No refund is available.';
  if (registration.status === 'FAILED') return 'Payment failed. This registration is not complete.';
  if (registration.status === 'EXPIRED' || checkoutClosed(registration)) return 'Checkout expired. This registration is not complete.';
  return 'Email confirmed; payment is still pending. This registration is not complete.';
}

export function ParentAccessPage({ client }: { client: Client }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingLink, setPendingLink] = useState<{ token: string; action: 'verify' | 'sign-in' | 'email-change' | 'registration-email-change' } | null>(() => {
    const values = new URLSearchParams(location.hash.replace(/^#/, ''));
    const token = values.get('token');
    const action = values.get('action');
    return token ? { token, action: action === 'email-change' || action === 'sign-in' || action === 'registration-email-change' ? action : 'verify' } : null;
  });
  const token = pendingLink?.token ?? null;
  const emailChange = pendingLink?.action === 'email-change';
  const registrationEmailChange = pendingLink?.action === 'registration-email-change';
  const signInLink = pendingLink?.action === 'sign-in';
  const [mode, setMode] = useState<Mode>(token ? 'confirm' : 'checking');
  const [registrations, setRegistrations] = useState<ParentRegistrationDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RegistrationDraft>>({});
  const [email, setEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyRegistration, setBusyRegistration] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<{ registrationId: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadRegistrations(): Promise<void> {
    const loaded = await client.listParentRegistrations();
    setRegistrations(loaded);
    setDrafts(Object.fromEntries(loaded.map((registration) => [registration.id, draftFrom(registration)])));
    setMode('portal');
  }

  useEffect(() => {
    if (pendingLink) {
      setMode('confirm');
      if (location.hash) navigate(location.pathname, { replace: true });
      return;
    }
    let active = true;
    client.listParentRegistrations()
      .then((loaded) => {
        if (!active) return;
        setRegistrations(loaded);
        setDrafts(Object.fromEntries(loaded.map((registration) => [registration.id, draftFrom(registration)])));
        setMode('portal');
      })
      .catch((reason: { status?: number }) => {
        if (!active) return;
        setMode('request');
        if (reason.status !== 401) setError('Could not load registrations. Check your connection and try again.');
      });
    return () => { active = false; };
  }, [client, location.hash, location.pathname, navigate, pendingLink]);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.requestParentAccessLink(email.trim());
      setMode('sent');
    } catch {
      setError('Could not request a sign-in link. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmLink() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (emailChange) await client.confirmParentEmailChange(token);
      else await client.verifyParentAccessToken(token);
      setPendingLink(null);
      navigate('/manage-registration', { replace: true });
    } catch (reason) {
      const code = (reason as { message?: string }).message;
      setError(emailChange && code === 'email_change_busy'
        ? 'A message is still being sent to your current address. Wait a few minutes, then confirm this change again.'
        : emailChange && code === 'email_change_unavailable'
          ? 'The new email could not be used for these registrations. Your current email is unchanged; contact the club or request another email-change link.'
          : 'This link is invalid, expired or already used. Request a fresh link and try again.');
    } finally {
      setBusy(false);
    }
  }

  function updateDraft<K extends keyof RegistrationDraft>(registrationId: string, key: K, value: RegistrationDraft[K]) {
    setDrafts((current) => ({ ...current, [registrationId]: { ...current[registrationId], [key]: value } }));
  }

  async function saveRegistration(registrationId: string, event: FormEvent) {
    event.preventDefault();
    setBusyRegistration(registrationId);
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateParentRegistration(registrationId, drafts[registrationId]);
      setRegistrations((current) => current.map((registration) => registration.id === registrationId ? updated : registration));
      setDrafts((current) => ({ ...current, [registrationId]: draftFrom(updated) }));
      setNotice('Registration details saved.');
    } catch (reason) {
      const status = (reason as { status?: number }).status;
      const code = (reason as { message?: string }).message;
      setError(status === 409 && code === 'already_registered'
        ? 'These player details match another registration in this event. Contact the club if they need correction.'
        : status === 400 && code === 'validation_failed'
          ? 'Position choices must be distinct, and a third choice requires a second choice. Your entries are still here.'
          : status === 409
            ? 'Registration editing has closed. Contact the club if a correction is needed.'
            : 'Could not save these changes. Your entries are still here; try again.');
    } finally {
      setBusyRegistration(null);
    }
  }

  async function withdraw(registration: ParentRegistrationDTO) {
    if (!window.confirm(`Withdraw ${registration.playerName} from ${registration.event.name}? No refund will be issued.`)) return;
    setBusyRegistration(registration.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await client.withdrawParentRegistration(registration.id);
      setRegistrations((current) => current.map((item) => item.id === registration.id ? updated : item));
      setNotice('Registration withdrawn. No refund was issued.');
    } catch (reason) {
      const code = (reason as { message?: string }).message;
      setError(code === 'checkout_in_progress'
        ? 'Checkout is open or being processed. Finish it or wait for it to expire before withdrawing.'
        : 'Could not withdraw this registration. It may have been closed; try again or contact the club.');
    } finally {
      setBusyRegistration(null);
    }
  }

  async function continueCheckout(registration: ParentRegistrationDTO) {
    setBusyRegistration(registration.id);
    setError(null);
    try {
      const result = await client.continueParentCheckout(registration.id);
      if ('simulationToken' in result) setSimulation({ registrationId: registration.id, token: result.simulationToken });
      else window.location.assign(result.checkoutUrl);
    } catch {
      setError('Could not start Checkout. Your registration is not complete; try again or contact the club.');
    } finally {
      setBusyRegistration(null);
    }
  }

  async function simulatePayment() {
    if (!simulation) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.completeFakePayment(simulation.token);
      if (result.status !== 'paid') throw new Error('not_paid');
      setSimulation(null);
      setNotice('Payment confirmed. Registration complete.');
      await loadRegistrations();
    } catch {
      setError('The test payment could not be completed. No payment was taken; retry or contact the club.');
    } finally {
      setBusy(false);
    }
  }

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    if (newEmail.trim().toLowerCase() === registrations[0]?.parentEmail.toLowerCase()) {
      setError('Enter an email address different from the current one.');
      setNotice(null);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.requestParentEmailChange(newEmail.trim());
      setNotice('Check the new email address to confirm the change. Your current email remains active until you confirm.');
      setNewEmail('');
    } catch (reason) {
      const status = (reason as { status?: number }).status;
      setError(status === 429
        ? 'Too many email-change requests. Wait a little while, then try again.'
        : 'We could not send the confirmation link. Your current email is unchanged; try again later.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await client.logoutParent();
    } finally {
      setRegistrations([]);
      setMode('request');
      setNotice('You have signed out.');
    }
  }

  if (mode === 'checking') return <p role="status">Checking registration access...</p>;

  if (mode === 'confirm') {
    return (
      <section className="public-page">
        <h1>{emailChange ? 'Confirm your new email' : signInLink ? 'Sign in to manage registrations' : registrationEmailChange ? 'Confirm your email address' : 'Confirm your email'}</h1>
        <p>{emailChange
          ? 'Confirm the new address to update it across registrations linked to your current email. Open this link in the browser where you requested the change.'
          : signInLink
            ? 'Continue to registrations linked to this email address.'
            : registrationEmailChange
              ? 'The club has updated an unconfirmed address. Confirm this new address to continue managing the registration.'
              : 'Confirm that you control this email address to manage the registrations linked to it.'}</p>
        {error ? <p role="alert">{error} <Link to="/manage-registration">Request a fresh link</Link></p> : null}
        <button type="button" disabled={busy} onClick={() => void confirmLink()}>{busy ? 'Confirming...' : emailChange ? 'Confirm email change' : signInLink ? 'Sign in and continue' : 'Confirm email and continue'}</button>
      </section>
    );
  }

  if (mode === 'request' || mode === 'sent') {
    return (
      <section className="public-page parent-access-page">
        <h1>Manage registrations</h1>
        {mode === 'sent' ? (
          <>
            <p role="status">If this email matches a registration, a secure link will arrive shortly. Check the inbox and junk folder.</p>
            <button type="button" className="button-secondary" onClick={() => setMode('request')}>Use another email</button>
          </>
        ) : (
          <>
            <p>Request a password-free sign-in link at the email address used for registration.</p>
            <p>Can’t access that inbox or entered the address incorrectly? <a href="https://chisholmnetball.com/">Contact the club</a> for help.</p>
            {error ? <p role="alert">{error}</p> : null}
            <form onSubmit={(event) => void requestLink(event)}>
              <p><label htmlFor="parent-access-email">Parent or guardian email</label><input id="parent-access-email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></p>
              <button type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending...' : 'Email me a sign-in link'}</button>
            </form>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="parent-access-page">
      <header className="parent-access-heading">
        <div>
          <h1>Manage registrations</h1>
          <p>Registrations linked to {registrations[0]?.parentEmail}.</p>
        </div>
        <button type="button" className="button-secondary" onClick={() => void signOut()}>Sign out</button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <section aria-labelledby="parent-email-change-heading">
        <h2 id="parent-email-change-heading">Parent or guardian email</h2>
        <p>Changing this address updates every registration linked to the current address after you confirm the new one.</p>
        <form onSubmit={(event) => void changeEmail(event)}>
          <p><label htmlFor="parent-new-email">New email address</label><input id="parent-new-email" type="email" autoComplete="email" required maxLength={320} value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></p>
          <button type="submit" className="button-secondary" disabled={busy || !newEmail.trim()}>Send confirmation link</button>
        </form>
      </section>
      <h2>Player registrations</h2>
      {registrations.map((registration) => {
        const draft = drafts[registration.id] ?? draftFrom(registration);
        const checkoutNeedsRestart = checkoutClosed(registration);
        const editingClosed = registration.event.status !== 'OPEN' || registration.checkedInAt !== null || registration.number !== null;
        return (
          <section className="parent-registration" key={registration.id} aria-labelledby={`parent-registration-${registration.id}`}>
            <h3 id={`parent-registration-${registration.id}`}>{registration.playerName} · {registration.event.name}</h3>
            <p>{formatTrialDate(registration.event.eventDate)} · {registration.event.venue} · Number {registration.number ?? 'Not assigned'}</p>
            <p role="status">{registrationStatus(registration)}</p>
            {registration.ticketPath ? <p><Link to={registration.ticketPath}>Open ticket</Link></p> : null}
            {registration.canContinueCheckout ? <p><button type="button" disabled={busyRegistration === registration.id} onClick={() => void continueCheckout(registration)}>Continue to Checkout</button></p> : null}
            {checkoutNeedsRestart && registration.event.status === 'OPEN'
              ? <p><Link to={`/register/${encodeURIComponent(registration.event.id)}`}>Start a new registration</Link></p>
              : null}
            {registration.canEdit ? (
              <form onSubmit={(event) => void saveRegistration(registration.id, event)}>
                <fieldset className="form-group" disabled={busyRegistration === registration.id}>
                  <legend>Update registration</legend>
                  <p><label htmlFor={`first-name-${registration.id}`}>Player first name</label><input id={`first-name-${registration.id}`} required maxLength={80} value={draft.playerFirstName} onChange={(event) => updateDraft(registration.id, 'playerFirstName', event.target.value)} /></p>
                  <p><label htmlFor={`last-name-${registration.id}`}>Player last name</label><input id={`last-name-${registration.id}`} required maxLength={80} value={draft.playerLastName} onChange={(event) => updateDraft(registration.id, 'playerLastName', event.target.value)} /></p>
                  <p><label htmlFor={`parent-name-${registration.id}`}>Parent or guardian name</label><input id={`parent-name-${registration.id}`} required maxLength={120} value={draft.parentName} onChange={(event) => updateDraft(registration.id, 'parentName', event.target.value)} /></p>
                  <p><label htmlFor={`parent-mobile-${registration.id}`}>Parent or guardian mobile</label><input id={`parent-mobile-${registration.id}`} type="tel" required maxLength={20} value={draft.parentMobile} onChange={(event) => updateDraft(registration.id, 'parentMobile', event.target.value)} /></p>
                  {([['First', 'rank1Position'], ['Second', 'rank2Position'], ['Third', 'rank3Position']] as const).map(([label, field]) => (
                    <p key={field}>
                      <label htmlFor={`${field}-${registration.id}`}>{label} position{field === 'rank1Position' ? ' (required)' : ' (optional)'}</label>
                      <select id={`${field}-${registration.id}`} required={field === 'rank1Position'} value={draft[field] ?? ''} onChange={(event) => updateDraft(registration.id, field, (event.target.value || null) as RegistrationDraft[typeof field])}>
                        {field !== 'rank1Position' ? <option value="">No preference</option> : <option value="">Choose a first position</option>}
                        {POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
                      </select>
                    </p>
                  ))}
                  <p><label htmlFor={`extra-games-${registration.id}`}><input id={`extra-games-${registration.id}`} type="checkbox" checked={draft.optInExtraPositions} onChange={(event) => updateDraft(registration.id, 'optInExtraPositions', event.target.checked)} /> Open to extra games outside my chosen positions</label></p>
                </fieldset>
                <button type="submit" disabled={busyRegistration === registration.id}>Save changes</button>
              </form>
            ) : editingClosed
              ? <p>Editing is closed. Contact the club if a correction is needed.</p>
              : registration.status === 'WITHDRAWN' ? null
                : <p>This registration is inactive. Start a new registration if the trial is still open.</p>}
            {registration.canWithdraw ? <button type="button" className="button-secondary" disabled={busyRegistration === registration.id} onClick={() => void withdraw(registration)}>Withdraw registration</button> : null}
            <p>Fee: {formatFee(registration.amountCents, registration.currency)} · Association: {registration.memberAssociation}</p>
          </section>
        );
      })}
      {simulation ? (
        <section className="message-confirmation" aria-labelledby="test-payment-heading">
          <h2 id="test-payment-heading">Test payment simulation</h2>
          <p>No real payment will be taken. Do not enter card details.</p>
          <button type="button" disabled={busy} onClick={() => void simulatePayment()}>{busy ? 'Simulating payment...' : 'Simulate successful payment'}</button>
        </section>
      ) : null}
    </section>
  );
}
