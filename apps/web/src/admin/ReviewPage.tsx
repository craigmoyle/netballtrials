import { useEffect, useState } from 'react';
import type { ReviewItemDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

const REASONS: Record<string, string> = {
  age_out_of_range: 'Age is outside the event range',
  payment_without_registration: 'Payment needs review. Compare the recorded note and Stripe status before deciding what action to take.',
};

export function ReviewPage({ client, eventId }: { client: Client; eventId: string }) {
  const [items, setItems] = useState<ReviewItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [includeResolved, setIncludeResolved] = useState(false);

  async function refresh() {
    try {
      setItems(await client.listReview(eventId, includeResolved));
      setError(null);
    } catch {
      setError('Could not load the review queue.');
    }
  }

  useEffect(() => {
    let active = true;
    client.listReview(eventId, includeResolved)
      .then((loaded) => { if (active) { setItems(loaded); setError(null); } })
      .catch(() => { if (active) setError('Could not load the review queue.'); });
    return () => { active = false; };
  }, [client, eventId, includeResolved]);

  async function resolve(item: ReviewItemDTO) {
    setBusy(true);
    setError(null);
    try {
      await client.resolveReview(eventId, item.id, notes[item.id] ?? '');
      setNotes((current) => { const next = { ...current }; delete next[item.id]; return next; });
      await refresh();
    } catch {
      setError('Could not resolve this item.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(item: ReviewItemDTO) {
    if (!window.confirm(`Withdraw ${item.registration.playerName} from this event?`)) return;
    setBusy(true);
    setError(null);
    try {
      await client.withdrawRegistration(eventId, item.registration.id);
      await refresh();
    } catch {
      setError('Could not withdraw this registration.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Review queue</h1>
      {error ? <p role="alert">{error} {error === 'Could not load the review queue.' ? <button type="button" onClick={() => void refresh()}>Retry loading reviews</button> : null}</p> : null}
      <p><label><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} /> Include resolved history</label></p>
      {items.length === 0 ? <p>{includeResolved ? 'No review items found.' : 'Nothing to review.'}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.registration.playerName}</span> — {REASONS[item.reason] ?? item.reason}
            {item.note ? <p>{item.note}</p> : null}
            {item.resolvedAt ? (
              <p>Reviewed {new Date(item.resolvedAt).toLocaleString()}</p>
            ) : (
              <>
                <p>
                  <label htmlFor={`note-${item.id}`}>Note</label>
                  <input id={`note-${item.id}`} maxLength={2000} value={notes[item.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Optional note" />
                </p>
                <button type="button" disabled={busy} onClick={() => resolve(item)}>
                  Mark reviewed
                </button>
                {item.reason === 'payment_without_registration' ? null : (
                  <button type="button" disabled={busy} onClick={() => withdraw(item)}>
                    Withdraw
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
