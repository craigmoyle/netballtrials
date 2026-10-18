import { useEffect, useState } from 'react';
import type { ReviewItemDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

const REASONS: Record<string, string> = {
  age_out_of_range: 'Age is outside the event range',
};

export function ReviewPage({ client, eventId }: { client: Client; eventId: string }) {
  const [items, setItems] = useState<ReviewItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function refresh() {
    try {
      setItems(await client.listReview(eventId));
      setError(null);
    } catch {
      setError('Could not load the review queue.');
    }
  }

  useEffect(() => {
    let active = true;
    client.listReview(eventId)
      .then((loaded) => { if (active) { setItems(loaded); setError(null); } })
      .catch(() => { if (active) setError('Could not load the review queue.'); });
    return () => { active = false; };
  }, [client, eventId]);

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
      {error ? <p role="alert">{error}</p> : null}
      {items.length === 0 ? <p>Nothing to review.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.registration.playerName}</span> — {REASONS[item.reason] ?? item.reason}
            <p>
              <label htmlFor={`note-${item.id}`}>Note</label>
              <input id={`note-${item.id}`} maxLength={2000} value={notes[item.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Optional note" />
            </p>
            <button type="button" disabled={busy} onClick={() => resolve(item)}>
              Mark reviewed
            </button>
            <button type="button" disabled={busy} onClick={() => withdraw(item)}>
              Withdraw
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
