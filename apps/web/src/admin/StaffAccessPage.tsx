import { useEffect, useState, type FormEvent } from 'react';
import type { AdminStaffDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';

type StaffAccessPageProps = { client: Client; embedded?: boolean };

export function StaffAccessPage({ client, embedded = false }: StaffAccessPageProps) {
  const [admins, setAdmins] = useState<AdminStaffDTO[]>([]);
  const [maxAdmins, setMaxAdmins] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAdmins() {
    setLoading(true);
    setError(null);
    try {
      const roster = await client.listStaff();
      setAdmins(roster.admins);
      setMaxAdmins(roster.maxAdmins);
    } catch {
      setError('Could not load the Admin list. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAdmins(); }, [client]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.inviteStaff(email.trim());
      setEmail('');
      setMessage('Invitation sent. They can request their own sign-in links from Staff sign-in whenever they need one.');
      await loadAdmins();
    } catch (reason) {
      setError(reason instanceof ApiError && reason.message === 'admin_limit_reached'
        ? `All ${maxAdmins ?? 5} Admin places are in use. Remove an Admin before inviting another.`
        : 'Could not send the invitation. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(admin: AdminStaffDTO) {
    if (busy || !window.confirm(`Remove ${admin.email} as an Admin? Their sessions and sign-in links will be revoked.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.removeStaff(admin.id);
      setAdmins((current) => current.filter((entry) => entry.id !== admin.id));
      setMessage(`${admin.email} no longer has Admin access.`);
    } catch {
      setError('Could not remove this Admin. Refresh the list and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={embedded ? 'site-settings-section staff-access-section' : 'staff-access-section'} aria-labelledby="staff-access-heading">
      {embedded ? <h2 id="staff-access-heading">Admin access</h2> : <h1 id="staff-access-heading">Staff access</h1>}
      <p>Inviting a committee member creates their Admin account and sends a sign-in link. They can request new links themselves from Staff sign-in whenever they need one.</p>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {maxAdmins !== null ? <p role="note">{admins.length} of {maxAdmins} Admin accounts in use.</p> : null}
      {loading ? <p role="status">Loading Admins…</p> : (
        <>
          {admins.length === 0 ? <p>No Admin accounts are listed.</p> : (
            <>
              {embedded ? <h3 id="current-admins-heading">Current Admins</h3> : <h2 id="current-admins-heading">Current Admins</h2>}
              <ul aria-labelledby="current-admins-heading">
              {admins.map((admin) => (
                <li key={admin.id}>
                  <span className="staff-admin-details">{admin.email} — Admin since {new Date(admin.createdAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne' })}</span>{' '}
                  {admin.canRemove ? <button type="button" className="button-secondary" disabled={busy} onClick={() => void remove(admin)}>Remove {admin.email}</button> : <span>(your account)</span>}
                </li>
              ))}
              </ul>
            </>
          )}
          {error === 'Could not load the Admin list. Try again.' ? <button type="button" className="button-secondary" onClick={() => void loadAdmins()}>Retry</button> : null}
          {maxAdmins !== null && admins.length >= maxAdmins ? <p>Remove an Admin before inviting another.</p> : (
            <form onSubmit={(event) => void invite(event)}>
              <p>
                <label htmlFor="staff-email">Committee member email</label>
                <input id="staff-email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
              </p>
              <button type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending invitation…' : 'Send invitation'}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
