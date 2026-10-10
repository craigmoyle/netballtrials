import { useEffect, useState } from 'react';
import type { EventDTO, PlannerGapDTO, RoundPlanDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function PlannerPage({ client, eventId }: { client: Client; eventId: string }) {
  const [plan, setPlan] = useState<RoundPlanDTO | null>(null);
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [gaps, setGaps] = useState<PlannerGapDTO[]>([]);
  const [fromRound, setFromRound] = useState(2);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .getPlan(eventId)
      .then((loaded) => {
        if (active) setPlan(loaded);
      })
      .catch(() => {
        if (active) setPlan(null);
      });

    const eventRequest = client.getEvent?.(eventId);
    if (eventRequest) {
      eventRequest
        .then((loaded) => {
          if (active) setEvent(loaded);
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
    };
  }, [client, eventId]);

  async function onGenerate() {
    setBusy(true);
    setGaps([]);
    try {
      const result = await client.generatePlan(eventId);
      if (result.ok) {
        setPlan(result.plan);
      } else {
        setGaps(result.gaps);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    setBusy(true);
    try {
      setPlan(await client.publishPlan(eventId));
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerate() {
    setBusy(true);
    setGaps([]);
    try {
      const result = await client.regeneratePlan(eventId, fromRound);
      if (result.ok) {
        setPlan(result.plan);
      } else {
        setGaps(result.gaps);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Round plan</h1>
      {event ? (
        <p>
          {event.name} — {event.courts} courts, {event.playMinutes} min games
        </p>
      ) : null}
      {plan ? (
        <p>
          {plan.status} — {plan.rounds} rounds.{' '}
          <a href={`/admin/events/${eventId}/sheets`}>Print selector sheets</a>
        </p>
      ) : null}
      {gaps.length > 0 ? (
        <div role="alert">
          {gaps.map((gap) => (
            <p key={`${gap.code}-${gap.message}`}>{gap.message}</p>
          ))}
        </div>
      ) : null}
      <p>
        <button type="button" onClick={onGenerate} disabled={busy}>
          {busy ? 'Working...' : 'Generate plan'}
        </button>
      </p>
      {plan ? (
        <>
          <p>
            <button type="button" onClick={onPublish} disabled={busy}>
              Publish
            </button>
          </p>
          <p>
            <label htmlFor="fromRound">Regenerate from round</label>
            <input
              id="fromRound"
              type="number"
              min={2}
              value={fromRound}
              onChange={(changeEvent) => setFromRound(Number(changeEvent.target.value))}
            />
            <button type="button" onClick={onRegenerate} disabled={busy}>
              Regenerate
            </button>
          </p>
        </>
      ) : null}
    </section>
  );
}
