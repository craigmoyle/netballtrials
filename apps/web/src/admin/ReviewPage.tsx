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

  async function refresh() {
    try {
      setItems(await client.listReview(eventId));
    } catch {
      setError('Could not load the review queue.');
    }
  }

  useEffect(() => {
    let active = true;
    refresh().finally(() => undefined);
    return () => {
      active = false;
    };
  }, [client, eventId]);

  async function resolve(item: ReviewItemDTO) {
    setBusy(true);
    setError(null);
    try {
      await client.resolveReview(eventId, item.id, 'Reviewed');
      await refresh();
    } catch {
      setError('Could not resolve this item.');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(item: ReviewItemDTO) {
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
              <input id={`note-${item.id}`} placeholder="Optional note" />
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
