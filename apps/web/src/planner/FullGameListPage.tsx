import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { POSITIONS, type EventCourtColorDTO, type EventDTO, type GamePlayerDTO, type ManualRoundInputDTO, type ManualSuffixInputDTO, type PlanRevisionSummaryDTO, type PlannerGapDTO, type RoundPlanDTO, type RoundPlanPlayerDTO, type RoundSlotDTO, type PlanSlotInputDTO } from '@netball-trials/types';
import { ApiError, type apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;
type ViewMode = 'team' | 'position' | 'statistics' | 'reference';
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
  return [...slots].sort((a, b) => a.round - b.round || a.court - b.court || POSITION_INDEX.get(a.position)! - POSITION_INDEX.get(b.position)! || a.team - b.team);
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
  const [earlyLeaverPanelOpen, setEarlyLeaverPanelOpen] = useState(false);
  const [suffixFromRound, setSuffixFromRound] = useState(1);
  const [earlyLeaverIds, setEarlyLeaverIds] = useState<string[]>([]);
  const [suffixEditing, setSuffixEditing] = useState(false);
  const [editedSuffixSlots, setEditedSuffixSlots] = useState<PlanSlotInputDTO[]>([]);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
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
    setEarlyLeaverPanelOpen(false);
    setSuffixFromRound(1);
    setEarlyLeaverIds([]);
    setSuffixEditing(false);
    setEditedSuffixSlots([]);
    setDraftMessage(null);
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
        setSuffixFromRound(loadedPlan ? Math.max(1, Math.min(loadedPlan.rounds, loadedPlan.frozenThroughRound + 1)) : 1);
      })
      .catch(() => { if (active) setLoadError('Could not load the game list. Retry or return to event settings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  const displayedPlan = historyPlan ?? plan;
  const availablePlan = displayedPlan;
  const readOnly = historyPlan !== null;
  const snapshotById = new Map((availablePlan?.players ?? []).map((player) => [player.registrationId, player]));
  const rosterById = new Map(roster.map((player) => [player.registrationId, player]));
  const reportPlayers: RoundPlanPlayerDTO[] = [
    ...(availablePlan?.players ?? []),
    ...(!readOnly ? roster.filter((player) => !snapshotById.has(player.registrationId)).map((player) => ({ ...player, active: true })) : []),
  ].sort((a, b) => (a.bibNumber ?? Number.MAX_SAFE_INTEGER) - (b.bibNumber ?? Number.MAX_SAFE_INTEGER) || a.playerName.localeCompare(b.playerName));
  const assignmentsByPlayer = new Map<string, RoundSlotDTO[]>();
  for (const slot of availablePlan?.slots ?? []) {
    const assignments = assignmentsByPlayer.get(slot.registrationId) ?? [];
    assignments.push(slot);
    assignmentsByPlayer.set(slot.registrationId, assignments);
  }

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
  const suffixDirty = suffixEditing && editedSuffixSlots.some((slot) => plan?.slots.find((original) => slotKey(planSlot(original)) === slotKey(slot))?.registrationId !== slot.registrationId);
  const dirtyAny = dirty || suffixDirty;
  const earlyLeaverSet = new Set(earlyLeaverIds);
  const earlyLeaverCandidates = plan?.players.filter((player) => player.active && rosterById.has(player.registrationId) &&
    plan.slots.some((slot) => slot.round >= suffixFromRound && slot.registrationId === player.registrationId)) ?? [];
  const lateArrivalPlayers = plan ? roster.filter((player) => !snapshotById.has(player.registrationId)) : [];
  const suffixReplacementSlots = editedSuffixSlots.filter((slot) => !slot.registrationId);

  function beginEdit(round: number) {
    if (!plan || stalePlan || suffixEditing) return;
    setSelectedRound(round);
    setViewMode('team');
    setEditedSlots(sortedSlots(plan.slots.filter((slot) => slot.round === round).map(planSlot)));
    setEditing(true);
    setEarlyLeaverPanelOpen(false);
    setEarlyLeaverIds([]);
    setSuffixEditing(false);
    setEditedSuffixSlots([]);
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

  function toggleEarlyLeaver(registrationId: string, checked: boolean) {
    setEarlyLeaverIds((current) => checked
      ? [...current, registrationId]
      : current.filter((id) => id !== registrationId));
    setDraftMessage(null);
  }

  function changeSuffixFromRound(round: number) {
    setSuffixFromRound(round);
    setEarlyLeaverIds([]);
    setSuffixEditing(false);
    setEditedSuffixSlots([]);
    setActionError(null);
    setDraftMessage(null);
  }

  function beginManualSuffix() {
    if (!plan || earlyLeaverIds.length === 0 || stalePlan) return;
    const leavers = new Set(earlyLeaverIds);
    setEditedSuffixSlots(sortedSlots(plan.slots.filter((slot) => slot.round >= suffixFromRound).map((slot) => {
      const input = planSlot(slot);
      return leavers.has(input.registrationId) ? { ...input, registrationId: '' } : input;
    })));
    setSuffixEditing(true);
    setEditing(false);
    setHistoryOpen(false);
    setEarlyLeaverPanelOpen(false);
    setSelectedRound(suffixFromRound);
    setViewMode('team');
    setWarnings([]);
    setActionError(null);
    setDraftMessage(null);
  }

  function replaceSuffixSlot(key: string, registrationId: string) {
    if (!suffixEditing || stalePlan) return;
    setEditedSuffixSlots((current) => current.map((slot) => slotKey(slot) === key ? { ...slot, registrationId } : slot));
    setWarnings([]);
    setActionError(null);
  }

  function suffixReplacementOptions(slot: PlanSlotInputDTO): GamePlayerDTO[] {
    const assignedElsewhere = new Set(editedSuffixSlots
      .filter((other) => other.round === slot.round && slotKey(other) !== slotKey(slot) && other.registrationId)
      .map((other) => other.registrationId));
    return roster.filter((player) => !earlyLeaverSet.has(player.registrationId) && !assignedElsewhere.has(player.registrationId));
  }

  function cancelSuffixEdit() {
    setSuffixEditing(false);
    setEditedSuffixSlots([]);
    setWarnings([]);
    if (!stalePlan) setActionError(null);
    setEarlyLeaverPanelOpen(true);
  }

  function activateRevision(nextPlan: RoundPlanDTO) {
    setPlan(nextPlan);
    setRevisions((current) => [{
      id: nextPlan.id,
      revision: nextPlan.revision,
      status: 'PUBLISHED',
      sourcePlanId: nextPlan.sourcePlanId,
      frozenThroughRound: nextPlan.frozenThroughRound,
      createdAt: nextPlan.createdAt,
      publishedAt: nextPlan.publishedAt,
      validationWarnings: nextPlan.validationWarnings,
    }, ...current.filter((revision) => revision.id !== nextPlan.id)]);
    setEditing(false);
    setEditedSlots([]);
    setSuffixEditing(false);
    setEditedSuffixSlots([]);
    setEarlyLeaverPanelOpen(false);
    setEarlyLeaverIds([]);
    setWarnings([]);
    setDraftMessage(null);
    setSavedMessage(`Revision ${nextPlan.revision} is now active.`);
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
      activateRevision(result.plan);
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

  async function saveSuffix(overrideWarnings = false) {
    if (!plan || !suffixEditing || suffixReplacementSlots.length > 0 || !suffixDirty || stalePlan) return;
    setBusy(true);
    setWarnings([]);
    setActionError(null);
    setSavedMessage(null);
    const input: ManualSuffixInputDTO = {
      sourcePlanId: plan.id,
      fromRound: suffixFromRound,
      slots: sortedSlots(editedSuffixSlots),
      removedRegistrationIds: earlyLeaverIds,
      overrideWarnings,
    };
    const submittedEventId = eventId;
    try {
      const result = await client.saveManualSuffix(submittedEventId, input);
      if (eventIdRef.current !== submittedEventId) return;
      if (!result.ok) {
        if (result.reason === 'warnings_required') setWarnings(result.warnings);
        else setActionError(result.errors.map((error) => error.message).join(' ') || 'The suffix has a hard validation error.');
        return;
      }
      activateRevision(result.plan);
    } catch (error) {
      if (eventIdRef.current !== submittedEventId) return;
      if (error instanceof ApiError && error.status === 409 && error.message === 'stale_plan') {
        setStalePlan(true);
        setActionError('Another Admin published a newer revision. Your local changes are not saved.');
      } else {
        setActionError('Could not save the suffix. Your local changes are still here; retry or cancel.');
      }
    } finally {
      if (eventIdRef.current === submittedEventId) setBusy(false);
    }
  }

  async function rebuildSuffix() {
    if (!plan || earlyLeaverIds.length === 0 || stalePlan) return;
    setBusy(true);
    setActionError(null);
    setSavedMessage(null);
    setDraftMessage(null);
    const submittedEventId = eventId;
    try {
      const result = await client.regeneratePlan(submittedEventId, suffixFromRound, earlyLeaverIds);
      if (eventIdRef.current !== submittedEventId) return;
      if (!result.ok) {
        setActionError(result.gaps.map((gap) => gap.message).join(' ') || 'The suffix could not be rebuilt. The active schedule is unchanged.');
        return;
      }
      setDraftMessage(`Draft revision ${result.plan.revision} is ready for review.`);
      setEarlyLeaverPanelOpen(false);
      setEarlyLeaverIds([]);
    } catch {
      if (eventIdRef.current === submittedEventId) setActionError('Could not rebuild the fixtures. The active schedule is unchanged.');
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
          {editing && selectedRound === round ? <p>Changes are local until saved.</p> : !readOnly ? <button type="button" className="button-secondary" disabled={busy || stalePlan || suffixEditing} onClick={() => beginEdit(round)}>Edit round {round}</button> : null}
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

  function renderPlayerStatistics() {
    return (
      <section className="player-report" aria-labelledby="player-statistics-heading">
        <h2 id="player-statistics-heading">Player Statistics</h2>
        <p>Other counts assignments outside the player's recorded choices.</p>
        <p className="player-report-scroll-note">Scroll horizontally to view all columns.</p>
        <div className="table-scroll" role="region" aria-label="Scrollable player statistics" tabIndex={0}>
          <table className="player-statistics-table">
            <caption>Player Statistics</caption>
            <thead><tr><th scope="col">Player</th><th scope="col">Number</th><th scope="col">Games</th><th scope="col">Rank 1</th><th scope="col">Rank 2</th><th scope="col">Rank 3</th><th scope="col">Other</th></tr></thead>
            <tbody>{reportPlayers.map((player) => {
              const slots = assignmentsByPlayer.get(player.registrationId) ?? [];
              const counts = { rank1: 0, rank2: 0, rank3: 0, other: 0 };
              for (const slot of slots) {
                if (slot.position === player.rank1Position) counts.rank1 += 1;
                else if (player.rank2Position && slot.position === player.rank2Position) counts.rank2 += 1;
                else if (player.rank3Position && slot.position === player.rank3Position) counts.rank3 += 1;
                else counts.other += 1;
              }
              return <tr key={player.registrationId}><th scope="row">{player.playerName}</th><td>{player.bibNumber ?? '—'}</td><td>{slots.length}</td><td>{counts.rank1}</td><td>{counts.rank2}</td><td>{counts.rank3}</td><td>{counts.other}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    );
  }

  function renderPlayerReference() {
    return (
      <section className="player-report" aria-labelledby="player-reference-heading">
        <h2 id="player-reference-heading">Player Reference</h2>
        <p className="player-report-scroll-note">Scroll horizontally to view all rounds.</p>
        <div className="table-scroll" role="region" aria-label="Scrollable player reference" tabIndex={0}>
          <table className="player-reference-table">
            <caption>Player Reference</caption>
            <thead><tr><th scope="col">Player</th><th scope="col">Number</th>{Array.from({ length: availablePlan?.rounds ?? 0 }, (_, index) => <th scope="col" key={index + 1}>Round {index + 1}</th>)}</tr></thead>
            <tbody>{reportPlayers.map((player) => <tr key={player.registrationId}>
              <th scope="row">{player.playerName}</th><td>{player.bibNumber ?? '—'}</td>
              {Array.from({ length: availablePlan?.rounds ?? 0 }, (_, index) => {
                const slot = assignmentsByPlayer.get(player.registrationId)?.find((assignment) => assignment.round === index + 1);
                if (!slot) return <td key={index + 1}>Not playing</td>;
                const teamName = slot.team === 0 ? 'Team A' : 'Team B';
                const color = colorFor(courtColors, slot.court, slot.team === 0 ? 0 : 1);
                return <td key={index + 1}>Court {slot.court}, {slot.position}, {teamName} — {color?.name ?? 'Color not set'}</td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    );
  }

  const roundsToRender = !availablePlan || viewMode === 'statistics' || viewMode === 'reference' ? [] : viewMode === 'position' || editing ? [selectedRound] : Array.from({ length: availablePlan.rounds }, (_, index) => index + 1);

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
              <button type="button" aria-expanded={historyOpen} disabled={busy || dirtyAny} onClick={() => setHistoryOpen((open) => !open)}>Revision history</button>
              {editing && dirty ? <p className="game-revision-subtitle">Save or cancel your round changes before viewing revision history.</p> : null}
              {suffixEditing && suffixDirty ? <p className="game-revision-subtitle">Save or cancel suffix replacements before viewing revision history.</p> : null}
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
                <select id="game-view" aria-label="Game view" value={viewMode} disabled={editing || suffixEditing} onChange={(changeEvent) => setViewMode(changeEvent.target.value as ViewMode)}>
                  <option value="team">Full game list</option><option value="position">Position View</option><option value="statistics">Player Statistics</option><option value="reference">Player Reference</option>
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
              {viewMode === 'team' || viewMode === 'position' ? (
                <label htmlFor="position-round">Round for position view
                  <select id="position-round" aria-label="Round for position view" value={selectedRound} disabled={editing || suffixEditing} onChange={(changeEvent) => setSelectedRound(Number(changeEvent.target.value))}>
                    {Array.from({ length: availablePlan.rounds }, (_, index) => <option key={index + 1} value={index + 1}>Round {index + 1}</option>)}
                  </select>
                </label>
              ) : null}

              {viewMode !== 'statistics' && viewMode !== 'reference' && plan && !historyPlan && plan.frozenThroughRound < plan.rounds ? (
                <section className="game-roster-changes" aria-labelledby="roster-changes-heading">
                  <h2 id="roster-changes-heading">Roster changes</h2>
                  {lateArrivalPlayers.length > 0 ? <p>{lateArrivalPlayers.length} newly eligible player(s) are available in Resting players.</p> : null}
                  {!earlyLeaverPanelOpen && !suffixEditing ? (
                    <button type="button" className="button-secondary" disabled={busy || stalePlan || editing} onClick={() => setEarlyLeaverPanelOpen(true)}>Remove early leaver</button>
                  ) : null}
                  {earlyLeaverPanelOpen ? (
                    <div className="early-leaver-selection">
                      <label htmlFor="suffix-from-round">Remove future assignments from round
                        <select id="suffix-from-round" aria-label="Remove future assignments from round" value={suffixFromRound} disabled={busy || suffixEditing} onChange={(changeEvent) => changeSuffixFromRound(Number(changeEvent.target.value))}>
                          {Array.from({ length: plan.rounds - plan.frozenThroughRound }, (_, index) => plan.frozenThroughRound + index + 1)
                            .map((round) => <option key={round} value={round}>Round {round}</option>)}
                        </select>
                      </label>
                      {earlyLeaverCandidates.length > 0 ? (
                        <fieldset>
                          <legend>Players assigned from round {suffixFromRound} onward</legend>
                          <ul>{earlyLeaverCandidates.map((player) => (
                            <li key={player.registrationId}>
                              <label><input type="checkbox" aria-label={`Remove ${player.playerName} from round ${suffixFromRound} onward`} checked={earlyLeaverSet.has(player.registrationId)} onChange={(changeEvent) => toggleEarlyLeaver(player.registrationId, changeEvent.target.checked)} />
                                {player.playerName} — Number {player.bibNumber ?? '—'}
                              </label>
                            </li>
                          ))}</ul>
                        </fieldset>
                      ) : <p>No active players are assigned after round {suffixFromRound}.</p>}
                      <div className="game-edit-actions">
                        <button type="button" className="button-secondary" disabled={!earlyLeaverIds.length || busy || stalePlan} onClick={beginManualSuffix}>Manual replacements</button>
                        <button type="button" disabled={!earlyLeaverIds.length || busy || stalePlan} onClick={() => void rebuildSuffix()}>{busy ? 'Rebuilding...' : 'Rebuild fixtures from round'}</button>
                        <button type="button" className="button-secondary" disabled={busy} onClick={() => { setEarlyLeaverPanelOpen(false); setEarlyLeaverIds([]); }}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                  {suffixEditing ? (
                    <section className="game-editor" aria-labelledby="manual-suffix-heading">
                      <h3 id="manual-suffix-heading">Manual replacements from round {suffixFromRound}</h3>
                      <p>Replace every future assignment for the selected player(s). Their registration and check-in record will not change.</p>
                      {suffixReplacementSlots.map((slot) => {
                        const original = plan.slots.find((item) => slotKey(planSlot(item)) === slotKey(slot));
                        const leaver = original ? playerDetails(original.registrationId, original) : { playerName: 'Early leaver', bibNumber: null };
                        const team = slot.team === 0 ? 'Team A' : 'Team B';
                        const label = `Replacement for round ${slot.round}, court ${slot.court}, ${team}, ${slot.position}`;
                        const replacementOptions = suffixReplacementOptions(slot);
                        return (
                          <p className="game-suffix-replacement" key={slotKey(slot)}>
                            <label htmlFor={`suffix-replacement-${slotKey(slot).replaceAll(':', '-')}`}>{label}</label>
                            <span>Replacing {leaver.playerName} — Number {leaver.bibNumber ?? '—'}</span>
                            <select id={`suffix-replacement-${slotKey(slot).replaceAll(':', '-')}`} aria-label={label} value={slot.registrationId} disabled={busy || stalePlan} onChange={(changeEvent) => replaceSuffixSlot(slotKey(slot), changeEvent.target.value)}>
                              <option value="">Choose a paid, checked-in player</option>
                              {replacementOptions.map((player) => <option key={player.registrationId} value={player.registrationId}>{player.playerName} — Number {player.bibNumber}</option>)}
                            </select>
                            {replacementOptions.length === 0 ? <span role="status">No paid and checked-in player is available for round {slot.round}.</span> : null}
                          </p>
                        );
                      })}
                      {suffixReplacementSlots.length === 0 ? <p>Every selected future assignment has a replacement.</p> : null}
                      <div className="game-edit-actions">
                        <button type="button" onClick={() => void saveSuffix(false)} disabled={busy || suffixReplacementSlots.length > 0 || !suffixDirty || stalePlan}>{busy ? 'Saving...' : 'Save manual suffix'}</button>
                        <button type="button" className="button-secondary" disabled={busy} onClick={cancelSuffixEdit}>Cancel suffix changes</button>
                      </div>
                      {warnings.length > 0 ? (
                        <div className="game-warning-list" role="alert">
                          <h3>Review these planning warnings</h3>
                          <ul>{warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>
                          <button type="button" onClick={() => void saveSuffix(true)} disabled={busy}>{busy ? 'Saving...' : 'Save suffix anyway'}</button>
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </section>
              ) : null}
              {draftMessage ? <div className="message-confirmation" role="status"><p>{draftMessage}</p><Link to={`/admin/events/${eventId}/plan`}>Review draft in Plan Rounds</Link></div> : null}

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

              {viewMode === 'statistics' ? renderPlayerStatistics() : viewMode === 'reference' ? renderPlayerReference() : viewMode === 'position'
                ? roundsToRender.map(renderPositionRound)
                : roundsToRender.map(renderTeamRound)}

              {viewMode === 'team' || viewMode === 'position' ? <section className="game-resting-list" aria-labelledby="resting-players-heading">
                <h2 id="resting-players-heading">Resting players</h2>
                {restingPlayers.length ? <ul>{restingPlayers.map((player) => (
                  <li key={player.registrationId} onDragOver={editing ? (event) => event.preventDefault() : undefined} onDrop={editing ? (event) => dropAssignedPlayerOnResting(event, player.registrationId) : undefined}>
                    {editing && !stalePlan ? <button type="button" draggable onDragStart={(event) => startDrag(event, player.registrationId)}>{player.playerName}</button> : player.playerName}
                    {' '}<span>Number {player.bibNumber ?? '—'}</span>
                  </li>
                ))}</ul> : <p>No players are resting or waiting to be placed in round {selectedRound}.</p>}
              </section> : null}

            </>
          )}
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}
