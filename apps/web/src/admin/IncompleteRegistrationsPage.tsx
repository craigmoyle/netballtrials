import { useEffect, useState, type FormEvent } from 'react';
import type { IncompleteRegistrationDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

function formatStartedAt(value: string): string {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne' }).format(new Date(value));
}

function stageLabel(registration: IncompleteRegistrationDTO): string {
  if (registration.stage === 'EMAIL_CONFIRMATION') return 'Email not confirmed';
  if (registration.stage === 'PAYMENT') return 'Payment pending';
  return registration.status === 'FAILED' ? 'Payment failed' : 'Checkout expired';
}

export function IncompleteRegistrationsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [registrations, setRegistrations] = useState<IncompleteRegistrationDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});
  const [familyConfirmed, setFamilyConfirmed] = useState<Record<string, boolean>>({});
  const [busyEmailId, setBusyEmailId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    client.listIncompleteRegistrations(eventId)
      .then((loaded) => { if (active) setRegistrations(loaded); })
      .catch(() => { if (active) setError('Could not load incomplete registrations. Try again.'); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  async function correctEmail(registration: IncompleteRegistrationDTO, event: FormEvent) {
    event.preventDefault();
    const email = emailDrafts[registration.id]?.trim();
    if (!email || !familyConfirmed[registration.id]) return;
    setBusyEmailId(registration.id);
    setError(null);
    setNotice(null);
    try {
      await client.requestIncompleteRegistrationEmailCorrection(eventId, registration.id, email, true);
      setEmailDrafts((current) => ({ ...current, [registration.id]: '' }));
      setFamilyConfirmed((current) => ({ ...current, [registration.id]: false }));
      setNotice(`Verification link sent to ${email}. The address will not change until the parent confirms it.`);
    } catch (reason) {
      setError((reason as { status?: number }).status === 429
        ? 'Too many verification links have been requested for this address. Wait before trying again.'
        : 'Could not send the verification link. Confirm the address with the family and try again.');
    } finally {
      setBusyEmailId(null);
    }
  }

  async function sendReminder(registration: IncompleteRegistrationDTO) {
    setBusyId(registration.id);
    setError(null);
    setNotice(null);
    try {
      await client.sendIncompleteRegistrationReminder(eventId, registration.id);
      setRegistrations((current) => current?.map((item) => item.id === registration.id
        ? { ...item, followUpSentAt: new Date().toISOString() }
        : item) ?? null);
      setNotice(`Payment reminder sent to ${registration.parentEmail}.`);
    } catch {
      setError('Could not send the payment reminder. The registration is unchanged; try again.');
    } finally {
      setBusyId(null);
    }
  }

  if (registrations === null && !error) return <p role="status">Loading incomplete registrations...</p>;

  return (
    <section className="incomplete-registrations-page">
      <h1>Incomplete registrations</h1>
      <p>Submitted registrations that have not completed email confirmation and payment. Records are shown for 30 days.</p>
      <p>For an unconfirmed address, verify the corrected address with the family through the club. The verified email can manage all registrations linked to it.</p>
      {error ? <p role="alert">{error} <button type="button" className="button-secondary" onClick={() => setRetry((count) => count + 1)}>Retry</button></p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!error && registrations?.length === 0 ? <p>No incomplete registrations in the last 30 days.</p> : null}
      {registrations && registrations.length > 0 ? (
        <>
          <p className="scroll-region-note">Scroll horizontally to review all follow-up details.</p>
          <div className="table-scroll" role="region" aria-label="Incomplete registrations" tabIndex={0}>
            <table className="incomplete-registrations-table">
              <caption>Registration attempts for the last 30 days</caption>
              <thead><tr><th scope="col">Player</th><th scope="col">Parent email</th><th scope="col">Started</th><th scope="col">Stage</th><th scope="col">Status</th><th scope="col">Follow-up</th></tr></thead>
              <tbody>{registrations.map((registration) => {
                const canRemind = registration.parentEmailVerified && registration.stage === 'PAYMENT' && !registration.followUpSentAt;
                return (
                  <tr key={registration.id}>
                    <th scope="row">{registration.playerName}</th>
                    <td>{registration.parentEmail}</td>
                    <td><time dateTime={registration.startedAt}>{formatStartedAt(registration.startedAt)}</time></td>
                    <td>{stageLabel(registration)}{registration.parentEmailVerified ? '' : ' · no reminder sent to unverified address'}</td>
                    <td>{registration.status}</td>
                    <td>{canRemind
                      ? <button type="button" className="button-secondary" disabled={busyId === registration.id} onClick={() => void sendReminder(registration)}>{busyId === registration.id ? 'Sending...' : 'Send payment reminder'}</button>
                      : !registration.parentEmailVerified ? (
                      <form className="incomplete-email-correction" onSubmit={(event) => void correctEmail(registration, event)}>
                        <input aria-label={`Corrected parent email for ${registration.playerName}`} type="email" required maxLength={320} value={emailDrafts[registration.id] ?? ''} onChange={(event) => {
                          setEmailDrafts((current) => ({ ...current, [registration.id]: event.target.value }));
                          setFamilyConfirmed((current) => ({ ...current, [registration.id]: false }));
                        }} />
                        <label><input type="checkbox" checked={familyConfirmed[registration.id] ?? false} onChange={(event) => setFamilyConfirmed((current) => ({ ...current, [registration.id]: event.target.checked }))} /> I confirmed this shared address with the family</label>
                        <button type="submit" className="button-secondary" disabled={busyEmailId === registration.id || !familyConfirmed[registration.id]}>{busyEmailId === registration.id ? 'Sending...' : 'Send verification link'}</button>
                      </form>
                    ) : registration.followUpSentAt ? 'Reminder sent' : '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
