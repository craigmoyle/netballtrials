import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventDTO, PlannerGapDTO, PlannerPreviewDTO, RoundPlanDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;
type PlanAction = { ok: true; plan: RoundPlanDTO } | { ok: false; gaps: PlannerGapDTO[] };

export function PlannerPage({ client, eventId }: { client: Client; eventId: string }) {
  const [plan, setPlan] = useState<RoundPlanDTO | null>(null);
  const [publishedPlan, setPublishedPlan] = useState<RoundPlanDTO | null>(null);
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [preview, setPreview] = useState<PlannerPreviewDTO | null>(null);
  const [gaps, setGaps] = useState<PlannerGapDTO[]>([]);
  const [fromRound, setFromRound] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      client.getPlan(eventId),
      client.getPublishedPlan(eventId),
      client.getEvent(eventId),
      client.getPlanPreview(eventId),
    ])
      .then(([loadedPlan, loadedPublishedPlan, loadedEvent, loadedPreview]) => {
        if (!active) return;
        setPlan(loadedPlan);
        setPublishedPlan(loadedPublishedPlan);
        setEvent(loadedEvent);
        setPreview(loadedPreview);
        setFromRound(Math.max(1, (loadedPublishedPlan?.frozenThroughRound ?? 0) + 1));
      })
      .catch(() => { if (active) setLoadError('Could not load event planning details. Retry or return to event settings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  function applyAction(result: PlanAction) {
    setActionError(null);
    if (result.ok) {
      setPlan(result.plan);
      setGaps([]);
      if (result.plan.status === 'PUBLISHED') setPublishedPlan(result.plan);
    } else {
      setGaps(result.gaps);
    }
  }

  async function onGenerate() {
    setBusy(true);
    setActionError(null);
    setGaps([]);
    try {
      applyAction(await client.generatePlan(eventId));
    } catch {
      setActionError('Could not generate a draft. Event settings and the last valid plan are unchanged.');
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    setBusy(true);
    setActionError(null);
    setGaps([]);
    try {
      applyAction(await client.publishPlan(eventId));
    } catch {
      setActionError('Could not publish this revision. The last published plan is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerate() {
    setBusy(true);
    setActionError(null);
    setGaps([]);
    try {
      applyAction(await client.regeneratePlan(eventId, fromRound));
    } catch {
      setActionError('Could not regenerate from this round. The published plan is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading planner settings...</p>;
  if (loadError || !event || !preview) {
    return <section><h1>Round planner</h1><p role="alert">{loadError ?? 'Planning settings are unavailable.'}</p><button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button></section>;
  }

  const canRegenerate = Boolean(publishedPlan && publishedPlan.frozenThroughRound < publishedPlan.rounds);

  return (
    <section>
      <h1>Round planner</h1>
      <p>{event.name} · {event.division} {event.section}</p>
      <p>
        Current settings: {event.courts} courts, {event.playMinutes}-minute games, {event.changeoverMinutes}-minute changeover; rank minimums {event.rank1Min}/{event.rank2Min}/{event.rank3Min}; playing window {event.firstWhistle}–{event.lastWhistle}.
      </p>
      <p>
        {preview.checkedInPlayers} checked-in players. Minimum round lower bound: {preview.minimumRounds}. At this lower bound, play requires {preview.requiredMinutes} minutes of the {preview.windowMinutes}-minute window.
      </p>
      <p>The lower bound is an estimate; the planner may need extra rounds to satisfy every court, position and fairness rule.</p>
      {!preview.fitsTimeWindow ? <p role="alert">The lower bound does not fit the playing window. Adjust settings before generating.</p> : null}
      <p><Link to={`/admin/events/${eventId}`}>Adjust event settings</Link></p>

      {publishedPlan ? (
        <p>{plan?.id === publishedPlan.id ? 'Published' : 'Active published'} revision {publishedPlan.revision} · {publishedPlan.rounds} rounds</p>
      ) : <p>No published revision yet.</p>}
      {plan && plan.id !== publishedPlan?.id ? <p>Draft revision {plan.revision} · {plan.rounds} rounds</p> : !plan ? <p>No draft plan yet.</p> : null}
      {plan && plan.slots.length > 0 ? (
        <div className="table-scroll">
          <table className="schedule-preview">
            <caption>Schedule preview — {plan.status.toLowerCase()} revision {plan.revision}</caption>
            <thead><tr><th scope="col">Round</th><th scope="col">Court</th><th scope="col">Team</th><th scope="col">Position</th><th scope="col">Number</th><th scope="col">Player</th></tr></thead>
            <tbody>
              {plan.slots.map((slot) => <tr key={slot.id}><td>{slot.round}</td><td>{slot.court}</td><td>{slot.team + 1}</td><td>{slot.position}</td><td>{slot.bibNumber ?? '—'}</td><td>{slot.playerName}</td></tr>)}
            </tbody>
          </table>
        </div>
      ) : plan ? <p>No schedule slots in this revision.</p> : <p>Generate a draft to preview the schedule.</p>}

      {gaps.length > 0 ? <div role="alert"><h2>Plan needs attention</h2><ul>{gaps.map((gap) => <li key={`${gap.code}-${gap.message}`}>{gap.message}</li>)}</ul><p>Adjust event settings or the checked-in roster, then generate a new draft.</p></div> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}

      <p><button type="button" onClick={onGenerate} disabled={busy}>{busy ? 'Working...' : 'Generate draft'}</button></p>
      {plan?.status === 'DRAFT' ? <p><button type="button" onClick={onPublish} disabled={busy}>{busy ? 'Working...' : 'Publish revision'}</button></p> : null}
      {publishedPlan ? (
        <>
          <p><Link to={`/admin/events/${eventId}/sheets`}>Print selector sheets</Link></p>
          {canRegenerate ? (
            <p>
              <label htmlFor="fromRound">Regenerate from round</label>
              <input id="fromRound" type="number" min={Math.max(1, publishedPlan.frozenThroughRound + 1)} max={publishedPlan.rounds} value={fromRound} onChange={(eventChange) => setFromRound(Number(eventChange.target.value))} />
              <button type="button" onClick={onRegenerate} disabled={busy || fromRound < Math.max(1, publishedPlan.frozenThroughRound + 1) || fromRound > publishedPlan.rounds}>{busy ? 'Working...' : 'Regenerate suffix'}</button>
            </p>
          ) : <p>All rounds in the published revision are frozen; there is no suffix to regenerate.</p>}
        </>
      ) : null}
    </section>
  );
}
