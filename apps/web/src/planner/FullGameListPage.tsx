import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { POSITIONS, type EventCourtColorDTO, type EventDTO, type GamePlayerDTO, type ManualRoundInputDTO, type PlanRevisionSummaryDTO, type PlannerGapDTO, type RoundPlanDTO, type RoundSlotDTO, type PlanSlotInputDTO } from '@netball-trials/types';
import { ApiError, type apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;
type ViewMode = 'team' | 'position';
type DisplayPlayer = { playerName: string; bibNumber: number | null };

const POSITION_INDEX = new Map(POSITIONS.map((position, index) => [position, index]));

function slotKey(slot: Pick<PlanSlotInputDTO, 'round' | 'court' | 'position' | 'team'>): string {
  return `${slot.round}:${slot.court}:${slot.position}:${slot.team}`;
}

function planSlot(slot: RoundSlotDTO): PlanSlotInputDTO {
  return { round: slot.round, court: slot.court, position: slot.position, team: slot.team === 0 ? 0 : 1, registrationId: slot.registrationId };
}

function colorFor(colors: EventCourtColorDTO[], court: number, team: 0 | 1) {
  const pair = colors.find((item) => item.court === court);
  return team === 0 ? pair?.teamAColor ?? null : pair?.teamBColor ?? null;
}

function sortedSlots(slots: PlanSlotInputDTO[]): PlanSlotInputDTO[] {
  return [...slots].sort((a, b) => a.court - b.court || POSITION_INDEX.get(a.position)! - POSITION_INDEX.get(b.position)! || a.team - b.team);
}

export function FullGameListPage({ client, eventId }: { client: Client; eventId: string }) {
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [plan, setPlan] = useState<RoundPlanDTO | null>(null);
  const [roster, setRoster] = useState<GamePlayerDTO[]>([]);
  const [revisions, setRevisions] = useState<PlanRevisionSummaryDTO[]>([]);
  const [courtColors, setCourtColors] = useState<EventCourtColorDTO[]>([]);
  const [historyPlan, setHistoryPlan] = useState<RoundPlanDTO | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRound, setSelectedRound] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [editing, setEditing] = useState(false);
  const [editedSlots, setEditedSlots] = useState<PlanSlotInputDTO[]>([]);
  const [playerToMove, setPlayerToMove] = useState('');
  const [destinationSlot, setDestinationSlot] = useState('');
  const [warnings, setWarnings] = useState<PlannerGapDTO[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [stalePlan, setStalePlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setEvent(null);
    setPlan(null);
    setRoster([]);
    setRevisions([]);
    setCourtColors([]);
    setHistoryPlan(null);
    setHistoryOpen(false);
    setSelectedRound(1);
    setViewMode('team');
    setEditing(false);
    setEditedSlots([]);
    setPlayerToMove('');
    setDestinationSlot('');
    setWarnings([]);
    setActionError(null);
    setSavedMessage(null);
    setStalePlan(false);
    setBusy(false);
    Promise.all([
      client.getEvent(eventId),
      client.getPublishedPlan(eventId),
      client.getGameRoster(eventId),
      client.getPlanRevisions(eventId),
      client.getCourtColors(eventId),
    ])
      .then(([loadedEvent, loadedPlan, loadedRoster, loadedRevisions, loadedColors]) => {
        if (!active) return;
        setEvent(loadedEvent);
        setPlan(loadedPlan);
        setRoster(loadedRoster);
        setRevisions(loadedRevisions);
        setCourtColors(loadedColors);
      })
      .catch(() => { if (active) setLoadError('Could not load the game list. Retry or return to event settings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  const displayedPlan = historyPlan ?? plan;
  const readOnly = historyPlan !== null;
  const snapshotById = new Map((displayedPlan?.players ?? []).map((player) => [player.registrationId, player]));
  const rosterById = new Map(roster.map((player) => [player.registrationId, player]));

  function playerDetails(registrationId: string, slot?: RoundSlotDTO): DisplayPlayer {
    const snapshot = snapshotById.get(registrationId);
    if (snapshot) return { playerName: snapshot.playerName, bibNumber: snapshot.bibNumber };
    const current = rosterById.get(registrationId);
    if (current) return { playerName: current.playerName, bibNumber: current.bibNumber };
    return { playerName: slot?.playerName ?? 'Former participant', bibNumber: slot?.bibNumber ?? null };
  }

  const baseSlots = (displayedPlan?.slots ?? []).map(planSlot);
  const renderedSlots = editing
    ? [...baseSlots.filter((slot) => slot.round !== selectedRound), ...editedSlots]
    : baseSlots;
  const selectedRoundSlots = editing ? editedSlots : renderedSlots.filter((slot) => slot.round === selectedRound);
  const selectedIds = new Set(selectedRoundSlots.map((slot) => slot.registrationId));
  const restingPlayers = (readOnly
    ? (displayedPlan?.players ?? []).filter((player) => player.active).map((player) => ({
        registrationId: player.registrationId, playerName: player.playerName, bibNumber: player.bibNumber ?? 0,
        rank1Position: player.rank1Position, rank2Position: player.rank2Position, rank3Position: player.rank3Position,
        optInExtraPositions: player.optInExtraPositions,
      }))
    : roster).filter((player) => !selectedIds.has(player.registrationId));
  const originalRoundSlots = plan?.slots.filter((slot) => slot.round === selectedRound).map(planSlot) ?? [];
  const dirty = editing && editedSlots.some((slot) => originalRoundSlots.find((original) => slotKey(original) === slotKey(slot))?.registrationId !== slot.registrationId);

  function beginEdit(round: number) {
    if (!plan || stalePlan) return;
    setSelectedRound(round);
    setViewMode('team');
    setEditedSlots(sortedSlots(plan.slots.filter((slot) => slot.round === round).map(planSlot)));
    setEditing(true);
    setHistoryOpen(false);
    setHistoryPlan(null);
    setWarnings([]);
    setActionError(null);
    setSavedMessage(null);
  }

  function cancelEdit() {
    setEditing(false);
    setEditedSlots([]);
    setPlayerToMove('');
    setDestinationSlot('');
    setWarnings([]);
    if (!stalePlan) setActionError(null);
    setSavedMessage(null);
  }

  function updateEditedSlots(next: PlanSlotInputDTO[]) {
    setEditedSlots(next);
    setWarnings([]);
    setActionError(null);
    setSavedMessage(null);
    setPlayerToMove('');
    setDestinationSlot('');
  }

  function movePlayer(registrationId: string, targetKey: string) {
    if (!editing || stalePlan) return;
    const sourceIndex = editedSlots.findIndex((slot) => slot.registrationId === registrationId);
    const targetIndex = editedSlots.findIndex((slot) => slotKey(slot) === targetKey);
    if (targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...editedSlots];
    if (sourceIndex < 0) {
      next[targetIndex] = { ...next[targetIndex], registrationId };
    } else {
      const displacedId = next[targetIndex].registrationId;
      next[targetIndex] = { ...next[targetIndex], registrationId };
      next[sourceIndex] = { ...next[sourceIndex], registrationId: displacedId };
    }
    updateEditedSlots(next);
  }

  function dropAssignedPlayerOnResting(event: DragEvent<HTMLLIElement>, restingId: string) {
    if (!editing || stalePlan) return;
    event.preventDefault();
    const registrationId = event.dataTransfer.getData('text/plain');
    const sourceIndex = editedSlots.findIndex((slot) => slot.registrationId === registrationId);
    if (sourceIndex < 0 || editedSlots.some((slot) => slot.registrationId === restingId)) return;
    const next = [...editedSlots];
    next[sourceIndex] = { ...next[sourceIndex], registrationId: restingId };
    updateEditedSlots(next);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, registrationId: string) {
    event.dataTransfer.setData('text/plain', registrationId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function dropOnSlot(event: DragEvent<HTMLTableRowElement>, slot: PlanSlotInputDTO) {
    if (!editing || stalePlan) return;
    event.preventDefault();
    const registrationId = event.dataTransfer.getData('text/plain');
    if (registrationId) movePlayer(registrationId, slotKey(slot));
  }

  async function saveRound(overrideWarnings = false) {
    if (!plan || !dirty || stalePlan) return;
    setBusy(true);
    setWarnings([]);
    setActionError(null);
    setSavedMessage(null);
    const input: ManualRoundInputDTO = {
      sourcePlanId: plan.id,
      slots: sortedSlots(editedSlots),
      overrideWarnings,
    };
    const submittedEventId = eventId;
    try {
      const result = await client.saveManualRound(submittedEventId, selectedRound, input);
      if (eventIdRef.current !== submittedEventId) return;
      if (!result.ok) {
        if (result.reason === 'warnings_required') setWarnings(result.warnings);
        else setActionError(result.errors.map((error) => error.message).join(' ') || 'The round has a hard validation error.');
        return;
      }
      setPlan(result.plan);
      setRevisions((current) => [{
        id: result.plan.id,
        revision: result.plan.revision,
        status: 'PUBLISHED',
        sourcePlanId: result.plan.sourcePlanId,
        frozenThroughRound: result.plan.frozenThroughRound,
        createdAt: result.plan.createdAt,
        publishedAt: result.plan.publishedAt,
        validationWarnings: result.plan.validationWarnings,
      }, ...current.filter((revision) => revision.id !== result.plan.id)]);
      setEditing(false);
      setEditedSlots([]);
      setWarnings([]);
      setSavedMessage(`Revision ${result.plan.revision} is now active.`);
    } catch (error) {
      if (eventIdRef.current !== submittedEventId) return;
      if (error instanceof ApiError && error.status === 409 && error.message === 'stale_plan') {
        setStalePlan(true);
        setActionError('Another Admin published a newer revision. Your local changes are not saved.');
      } else {
        setActionError('Could not save this round. Your local changes are still here; retry or cancel.');
      }
    } finally {
      if (eventIdRef.current === submittedEventId) setBusy(false);
    }
  }

  async function openRevision(revision: PlanRevisionSummaryDTO) {
    const requestedEventId = eventId;
    setBusy(true);
    setActionError(null);
    try {
      const revisionPlan = await client.getPlanRevision(requestedEventId, revision.id);
      if (eventIdRef.current !== requestedEventId) return;
      setHistoryPlan(revisionPlan);
      setEditing(false);
      setEditedSlots([]);
      setSelectedRound(1);
      setViewMode('team');
    } catch {
      if (eventIdRef.current === requestedEventId) setActionError('Could not load that revision. The active schedule is unchanged.');
    } finally {
      if (eventIdRef.current === requestedEventId) setBusy(false);
    }
  }

  function returnToActive() {
    setHistoryPlan(null);
    setActionError(null);
    setSelectedRound(1);
  }

  function discardAndRefresh() {
    setStalePlan(false);
    setHistoryPlan(null);
    setEditing(false);
    setEditedSlots([]);
    setWarnings([]);
    setActionError(null);
    setPlayerToMove('');
    setDestinationSlot('');
    setRetry((count) => count + 1);
  }

  function renderTeamTable(round: number, court: number, team: 0 | 1) {
    const color = colorFor(courtColors, court, team);
    const teamName = team === 0 ? 'Team A' : 'Team B';
    return (
      <section className="full-game-team" aria-label={`Court ${court} ${teamName}`} key={`${court}-${team}`}>
        <h4>{teamName}</h4>
        <p className="full-game-color">
          <span className="bib-color-swatch" role="img" aria-label={`${color?.name ?? 'Unassigned'} bib color swatch`} style={{ backgroundColor: color?.hex ?? 'transparent' }} />
          <span>{color?.name ?? 'Color not set'}</span>
        </p>
        <table className="full-game-table">
          <caption>Round {round}, Court {court}, {teamName}</caption>
          <thead><tr><th scope="col">Position</th><th scope="col">Player</th><th scope="col">Number</th></tr></thead>
          <tbody>
            {POSITIONS.map((position) => {
              const slot = renderedSlots.find((item) => item.round === round && item.court === court && item.position === position && item.team === team);
              if (!slot) return <tr key={position}><th scope="row">{position}</th><td>Unfilled</td><td>—</td></tr>;
              const fullSlot = displayedPlan?.slots.find((item) => slotKey(planSlot(item)) === slotKey(slot));
              const player = playerDetails(slot.registrationId, fullSlot);
              const movable = editing && !stalePlan && rosterById.has(slot.registrationId);
              return (
                <tr key={position} onDragOver={editing ? (event) => event.preventDefault() : undefined} onDrop={editing ? (event) => dropOnSlot(event, slot) : undefined}>
                  <th scope="row">{position}</th>
                  <td>
                    {movable ? <button type="button" className="game-player-drag" draggable onDragStart={(event) => startDrag(event, slot.registrationId)}>{player.playerName}</button> : player.playerName}
                  </td>
                  <td>{player.bibNumber ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  }

  function renderTeamRound(round: number) {
    const courts = Array.from({ length: displayedPlan?.courts ?? 0 }, (_, index) => index + 1);
    return (
      <section className="full-game-round" aria-labelledby={`game-round-${round}`} key={round}>
        <header className="full-game-round-heading">
          <h2 id={`game-round-${round}`}>Round {round}</h2>
          {editing && selectedRound === round ? <p>Changes are local until saved.</p> : !readOnly ? <button type="button" className="button-secondary" disabled={busy || stalePlan} onClick={() => beginEdit(round)}>Edit round {round}</button> : null}
        </header>
        <div className="full-game-courts">
          {courts.map((court) => (
            <section className="full-game-court" aria-labelledby={`game-round-${round}-court-${court}`} key={court}>
              <h3 id={`game-round-${round}-court-${court}`}>Court {court}</h3>
              <div className="full-game-teams">{renderTeamTable(round, court, 0)}{renderTeamTable(round, court, 1)}</div>
            </section>
          ))}
        </div>
      </section>
    );
  }

  function renderPositionRound(round: number) {
    const courts = Array.from({ length: displayedPlan?.courts ?? 0 }, (_, index) => index + 1);
    return (
      <section className="full-game-round" aria-labelledby={`position-round-${round}`} key={round}>
        <h2 id={`position-round-${round}`}>Round {round}</h2>
        <div className="full-game-courts">
          {courts.map((court) => {
            const colorA = colorFor(courtColors, court, 0);
            const colorB = colorFor(courtColors, court, 1);
            return (
              <section className="full-game-court" aria-labelledby={`position-round-${round}-court-${court}`} key={court}>
                <h3 id={`position-round-${round}-court-${court}`}>Court {court}</h3>
                <table className="full-game-position-table">
                  <caption>Round {round} by position, Court {court}</caption>
                  <thead><tr>
                    <th scope="col">Position</th>
                    <th scope="col"><span className="game-position-team-heading"><span className="bib-color-swatch" aria-hidden="true" style={{ backgroundColor: colorA?.hex ?? 'transparent' }} />Team A — {colorA?.name ?? 'Color not set'}</span></th>
                    <th scope="col"><span className="game-position-team-heading"><span className="bib-color-swatch" aria-hidden="true" style={{ backgroundColor: colorB?.hex ?? 'transparent' }} />Team B — {colorB?.name ?? 'Color not set'}</span></th>
                  </tr></thead>
                  <tbody>{POSITIONS.map((position) => (
                    <tr key={position}>
                      <th scope="row">{position}</th>
                      {[0, 1].map((team) => {
                        const slot = renderedSlots.find((item) => item.round === round && item.court === court && item.position === position && item.team === team);
                        const fullSlot = slot && displayedPlan?.slots.find((item) => slotKey(planSlot(item)) === slotKey(slot));
                        const player = slot ? playerDetails(slot.registrationId, fullSlot) : null;
                        return <td key={team}>{player ? <><span>{player.playerName}</span><span className="game-player-number">Number {player.bibNumber ?? '—'}</span></> : 'Unfilled'}</td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </section>
            );
          })}
        </div>
      </section>
    );
  }

  const availablePlan = displayedPlan;
  const roundsToRender = !availablePlan ? [] : viewMode === 'position' || editing ? [selectedRound] : Array.from({ length: availablePlan.rounds }, (_, index) => index + 1);

  return (
    <section className="full-game-page">
      <div className="full-game-layout">
        <aside className="full-game-sidebar">
          <p className="full-game-event-name">{event?.name ?? 'Loading event details...'}</p>
          <nav aria-label="Game list navigation">
            <Link to={`/admin/events/${eventId}/plan`}>Plan Rounds</Link>
            <Link to={`/admin/events/${eventId}`}>Event settings</Link>
          </nav>
          {availablePlan && revisions.length > 0 ? (
            <section className="game-revision-history">
              <button type="button" aria-expanded={historyOpen} disabled={busy || (editing && dirty)} onClick={() => setHistoryOpen((open) => !open)}>Revision history</button>
              {editing && dirty ? <p className="game-revision-subtitle">Save or cancel your round changes before viewing revision history.</p> : null}
              {historyOpen ? (
                <div>
                  <p className="game-revision-subtitle">Earlier revisions</p>
                  {revisions.filter((revision) => revision.id !== plan?.id).length > 0 ? (
                    <ul>{revisions.filter((revision) => revision.id !== plan?.id).map((revision) => (
                      <li key={revision.id}><button type="button" disabled={busy} onClick={() => void openRevision(revision)}>View revision {revision.revision}</button></li>
                    ))}</ul>
                  ) : <p>No earlier revisions.</p>}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>

        <section className="full-game-content" aria-labelledby="full-game-title">
          <header className="full-game-header">
            <div><h1 id="full-game-title">Full Game List</h1>{event ? <p>{event.division} {event.section} · {event.courts} courts</p> : null}</div>
            {!loading && availablePlan ? (
              <label htmlFor="game-view">Game view
                <select id="game-view" aria-label="Game view" value={viewMode} disabled={editing} onChange={(changeEvent) => setViewMode(changeEvent.target.value as ViewMode)}>
                  <option value="team">Full game list</option><option value="position">Position View</option>
                </select>
              </label>
            ) : null}
          </header>

          {loading ? (
            <div className="full-game-loading">
              <p role="status" aria-busy="true">Loading game list...</p>
              <div className="full-game-loading-skeleton" aria-hidden="true"><span /><span /><span /></div>
            </div>
          ) : null}
          {!loading && (loadError || !event) ? (
            <div className="game-action-error" role="alert"><p>{loadError ?? 'Event details are unavailable.'}</p><button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button></div>
          ) : null}
          {!loading && !loadError && event ? (
            <>
          {historyPlan ? <div className="game-history-banner"><p>Viewing revision {historyPlan.revision} — read-only</p><button type="button" onClick={returnToActive}>Return to active revision</button></div> : null}
          {plan ? <p className="game-active-revision">Active revision {plan.revision}</p> : null}
          {savedMessage ? <p role="status">{savedMessage}</p> : null}
          {actionError ? (
            <div role="alert" className="game-action-error">
              <p>{actionError}</p>
              {stalePlan ? <button type="button" onClick={discardAndRefresh}>Discard local changes and refresh</button> : null}
            </div>
          ) : null}

          {!availablePlan ? (
            <div className="game-empty-state"><h2>No published game plan yet.</h2><p>Generate and publish the schedule before reviewing or editing games.</p><Link to={`/admin/events/${eventId}/plan`}>Open Plan Rounds</Link></div>
          ) : (
            <>
              <p className="game-plan-revision">Revision {availablePlan.revision} · {availablePlan.rounds} rounds</p>
              {availablePlan.validationWarnings.length > 0 ? (
                <section className="game-warning-list" aria-labelledby="saved-warnings-heading">
                  <h2 id="saved-warnings-heading">Saved planning warnings</h2>
                  <ul>{availablePlan.validationWarnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>
                </section>
              ) : null}
              <label htmlFor="position-round">Round for position view
                <select id="position-round" aria-label="Round for position view" value={selectedRound} disabled={editing} onChange={(changeEvent) => setSelectedRound(Number(changeEvent.target.value))}>
                  {Array.from({ length: availablePlan.rounds }, (_, index) => <option key={index + 1} value={index + 1}>Round {index + 1}</option>)}
                </select>
              </label>

              {editing ? (
                <section className="game-editor" aria-labelledby="game-editor-title">
                  <h2 id="game-editor-title">Edit round {selectedRound}</h2>
                  <p>Move or substitute players within this round. Other rounds stay unchanged.</p>
                  <div className="game-move-controls">
                    <label htmlFor="player-to-move">Player to move
                      <select id="player-to-move" value={playerToMove} disabled={busy || stalePlan} onChange={(changeEvent) => setPlayerToMove(changeEvent.target.value)}>
                        <option value="">Choose a player</option>
                        {roster.map((player) => <option key={player.registrationId} value={player.registrationId}>{player.playerName} — Number {player.bibNumber}{selectedIds.has(player.registrationId) ? ', playing this round' : ', resting or available'}</option>)}
                      </select>
                    </label>
                    <label htmlFor="destination-slot">Destination slot
                      <select id="destination-slot" value={destinationSlot} disabled={busy || stalePlan} onChange={(changeEvent) => setDestinationSlot(changeEvent.target.value)}>
                        <option value="">Choose a court position</option>
                        {sortedSlots(editedSlots).map((slot) => {
                          const current = rosterById.get(slot.registrationId) ?? playerDetails(slot.registrationId);
                          return <option key={slotKey(slot)} value={slotKey(slot)}>Court {slot.court}, Team {slot.team === 0 ? 'A' : 'B'}, {slot.position} — {current.playerName}, Number {current.bibNumber ?? '—'}</option>;
                        })}
                      </select>
                    </label>
                    <button type="button" className="button-secondary" disabled={!playerToMove || !destinationSlot || busy || stalePlan} onClick={() => movePlayer(playerToMove, destinationSlot)}>Move or substitute</button>
                  </div>
                  <div className="game-edit-actions">
                    <button type="button" onClick={() => void saveRound(false)} disabled={busy || !dirty || stalePlan}>{busy ? 'Saving...' : `Save round ${selectedRound}`}</button>
                    <button type="button" className="button-secondary" disabled={busy} onClick={cancelEdit}>Cancel changes</button>
                  </div>
                  {warnings.length > 0 ? (
                    <div className="game-warning-list" role="alert">
                      <h3>Review these planning warnings</h3>
                      <ul>{warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>
                      <button type="button" onClick={() => void saveRound(true)} disabled={busy}>{busy ? 'Saving...' : 'Save anyway'}</button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {viewMode === 'position'
                ? roundsToRender.map(renderPositionRound)
                : roundsToRender.map(renderTeamRound)}

              <section className="game-resting-list" aria-labelledby="resting-players-heading">
                <h2 id="resting-players-heading">Resting players</h2>
                {restingPlayers.length ? <ul>{restingPlayers.map((player) => (
                  <li key={player.registrationId} onDragOver={editing ? (event) => event.preventDefault() : undefined} onDrop={editing ? (event) => dropAssignedPlayerOnResting(event, player.registrationId) : undefined}>
                    {editing && !stalePlan ? <button type="button" draggable onDragStart={(event) => startDrag(event, player.registrationId)}>{player.playerName}</button> : player.playerName}
                    {' '}<span>Number {player.bibNumber ?? '—'}</span>
                  </li>
                ))}</ul> : <p>No players are resting or waiting to be placed in round {selectedRound}.</p>}
              </section>

            </>
          )}
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}
