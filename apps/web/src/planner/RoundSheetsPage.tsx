import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventDTO, RoundPlanDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { HelpTip } from '../admin/HelpTip';
import { POSITIONS } from '@netball-trials/types';

type Orientation = 'portrait' | 'landscape';

export function RoundSheetsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [plan, setPlan] = useState<RoundPlanDTO | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([client.getEvent(eventId), client.getPublishedPlan(eventId)])
      .then(([loadedEvent, loadedPlan]) => {
        if (!active) return;
        setEvent(loadedEvent);
        setPlan(loadedPlan?.status === 'PUBLISHED' ? loadedPlan : null);
      })
      .catch(() => { if (active) setError('Could not load the event and published rounds. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  const playerById = new Map((plan?.players ?? []).map((player) => [player.registrationId, player]));
  const slotByKey = new Map((plan?.slots ?? []).map((slot) => [`${slot.round}:${slot.court}:${slot.position}:${slot.team}`, slot]));

  return (
    <section className="round-sheets-page">
      <header className="round-sheets-controls no-print">
        <h1>Round handouts</h1>
        <p>Print one sheet per round so players can find their court, position and team.</p>
        {plan ? (
          <>
            <div className="round-sheet-help">One round prints on each sheet. <HelpTip label="Page orientation">Landscape places courts in three columns; portrait uses two. Both keep every court on the same round sheet.</HelpTip></div>
            <fieldset className="round-sheet-orientation">
              <legend>Page orientation</legend>
              {(['landscape', 'portrait'] as const).map((value) => (
                <label key={value}>
                  <input type="radio" name="round-sheet-orientation" value={value} checked={orientation === value} onChange={() => setOrientation(value)} />
                  {value === 'landscape' ? 'Landscape' : 'Portrait'}
                </label>
              ))}
            </fieldset>
            <button type="button" onClick={() => window.print()}>Print round handouts</button>
          </>
        ) : null}
        <nav aria-label="Round handout links">
          <Link to={`/admin/events/${eventId}/games`}>Full Game List</Link>{' '}
          <Link to={`/admin/events/${eventId}/plan`}>Plan rounds</Link>
        </nav>
      </header>

      {loading ? <p role="status">Loading published rounds…</p> : null}
      {!loading && error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button></div> : null}
      {!loading && !error && !plan ? (
        <div className="round-sheet-empty">
          <p role="status">Publish a round plan before printing handouts.</p>
          <Link to={`/admin/events/${eventId}/plan`}>Open Plan rounds</Link>
        </div>
      ) : null}
      {!loading && !error && plan ? (
        <div className={`round-sheet-preview round-sheet-preview--${orientation}`} data-orientation={orientation} data-courts={plan.courts} role="region" aria-label="Round handout preview">
          <style>{`@media print { @page { size: A4 ${orientation}; margin: 8mm; } }`}</style>
          {Array.from({ length: plan.rounds }, (_, index) => {
            const round = index + 1;
            return (
              <article className="round-print-sheet" aria-labelledby={`round-sheet-title-${round}`} key={round}>
                <header className="round-print-heading">
                  <h2 id={`round-sheet-title-${round}`}>{event?.name ?? plan.eventName} — Round {round}</h2>
                  <p>{event?.eventDate ? new Date(event.eventDate).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'long' }) : ''}{event?.venue ? ` · ${event.venue}` : ''}{event?.gameStartTime ? ` · Games start ${event.gameStartTime}` : ''}</p>
                </header>
                <div className="round-print-courts">
                  {Array.from({ length: plan.courts }, (_, courtIndex) => {
                    const court = courtIndex + 1;
                    return (
                      <section className="round-print-court" aria-labelledby={`round-${round}-court-${court}`} key={court}>
                        <h3 id={`round-${round}-court-${court}`}>Court {court}</h3>
                        <table aria-label={`Round ${round}, Court ${court}`}>
                          <thead><tr><th scope="col">Position</th><th scope="col">Team A</th><th scope="col">Team B</th></tr></thead>
                          <tbody>{POSITIONS.map((position) => (
                            <tr key={position}>
                              <th scope="row">{position}</th>
                              {[0, 1].map((team) => {
                                const slot = slotByKey.get(`${round}:${court}:${position}:${team}`);
                                const player = slot?.registrationId ? playerById.get(slot.registrationId) : undefined;
                                const name = slot?.playerName ?? player?.playerName;
                                const number = slot?.bibNumber ?? player?.bibNumber;
                                return <td key={team}>{name ? <span className="round-sheet-player">{name}<small>Number {number ?? '—'}</small></span> : 'Unfilled'}</td>;
                              })}
                            </tr>
                          ))}</tbody>
                        </table>
                      </section>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
