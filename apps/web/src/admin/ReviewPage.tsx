import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReviewItemDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

const REASONS: Record<string, string> = {
  age_out_of_range: 'Age is outside the event range',
  payment_without_registration: 'Payment needs review',
  registration_incomplete: 'Registration is incomplete',
  late_addition_incomplete: 'Late addition is incomplete',
  checkout_creation_failed: 'Checkout could not be prepared',
  delivery_failed: 'Email delivery failed',
  delivery_ambiguous: 'Email delivery outcome is ambiguous',
  scheduled_message_failed: 'Scheduled communication failed',
  planner_reconciliation: 'Planner reconciliation needs review',
};

export function ReviewPage({ client, eventId }: { client: Client; eventId: string }) {
  const [items, setItems] = useState<ReviewItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [withdrawalReasons, setWithdrawalReasons] = useState<Record<string, string>>({});
  const [includeResolved, setIncludeResolved] = useState(false);

  async function refresh() {
    try {
      setItems(await client.listNeedsAttention(eventId, includeResolved));
      setError(null);
    } catch {
      setError('Could not load Needs attention.');
    }
  }

  useEffect(() => {
    let active = true;
    client.listNeedsAttention(eventId, includeResolved)
      .then((loaded) => { if (active) { setItems(loaded); setError(null); } })
      .catch(() => { if (active) setError('Could not load Needs attention.'); });
    return () => { active = false; };
  }, [client, eventId, includeResolved]);

  async function resolve(item: ReviewItemDTO) {
    const reason = (reasons[item.id] ?? '').trim();
    if (reason.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await client.resolveNeedsAttention(eventId, item.id, reason);
      setReasons((current) => { const next = { ...current }; delete next[item.id]; return next; });
      await refresh();
    } catch {
      setError('Could not acknowledge this item.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(item: ReviewItemDTO) {
    const withdrawalReason = withdrawalReasons[item.id] ?? '';
    const note = (reasons[item.id] ?? '').trim();
    if (!item.registration || !withdrawalReason || (withdrawalReason === 'Other' && !note) || !window.confirm(`Withdraw ${item.registration.playerName} from this event?`)) return;
    setBusy(true);
    setError(null);
    try {
      await client.withdrawRegistration(eventId, item.registration.id, {
        reason: withdrawalReason,
        note,
      });
      await refresh();
    } catch {
      setError('Could not withdraw this registration.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Needs attention</h1>
      <p>Registration, delivery, payment and planning exceptions stay here until an Admin records a short reason and acknowledges or resolves them.</p>
      {error ? <p role="alert">{error} {error === 'Could not load Needs attention.' ? <button type="button" onClick={() => void refresh()}>Retry</button> : null}</p> : null}
      <p><label><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} /> Include resolved history</label></p>
      {items.length === 0 ? <p>{includeResolved ? 'No attention items found.' : 'Nothing needs attention.'}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.registration?.playerName ?? REASONS[item.reason] ?? item.reason}</strong>
            {item.registration ? <> — {REASONS[item.reason] ?? item.reason}</> : null}
            {item.note ? <p>{item.note}</p> : null}
            {item.delivery ? <p>Delivery {item.delivery.status.toLowerCase()} to {item.delivery.to} · attempt {item.delivery.attempts}</p> : null}
            <p><Link to={item.link?.path ?? `/admin/events/${eventId}/roster`}>{item.link?.label ?? 'Open related record'}</Link></p>
            {item.resolvedAt ? (
              <p>Resolved {new Date(item.resolvedAt).toLocaleString()}</p>
            ) : (
              <>
                <p>
                  <label htmlFor={`reason-${item.id}`}>Short resolution reason</label>
                  <input id={`reason-${item.id}`} required minLength={3} maxLength={500} value={reasons[item.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="What was checked or actioned?" />
                </p>
                <button type="button" disabled={busy || (reasons[item.id] ?? '').trim().length < 3} onClick={() => void resolve(item)}>Acknowledge or resolve</button>
                {item.registration && !item.reason.startsWith('payment_') ? <>
                  <p><label htmlFor={`withdrawal-reason-${item.id}`}>Withdrawal reason</label><select id={`withdrawal-reason-${item.id}`} required value={withdrawalReasons[item.id] ?? ''} onChange={(event) => setWithdrawalReasons((current) => ({ ...current, [item.id]: event.target.value }))}>
                    <option value="">Choose a reason</option><option>Unable to attend</option><option>Late withdrawal</option><option>Ineligible correction</option><option>Did not arrive</option><option>Other</option>
                  </select></p>
                  <button type="button" disabled={busy || !(withdrawalReasons[item.id] ?? '') || (withdrawalReasons[item.id] === 'Other' && !(reasons[item.id] ?? '').trim())} onClick={() => void withdraw(item)}>Withdraw</button>
                </> : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
