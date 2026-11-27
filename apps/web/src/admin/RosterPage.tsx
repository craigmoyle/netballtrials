import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { POSITIONS, melbourneDateKey, type MemberAssociationDTO, type PlannerGapDTO, type PlanningChangeDTO, type Position, type RosterDTO, type RosterRegistrationDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';
import { formatFee } from '../formatFee';

function saveCsv(blob: Blob, eventId: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `roster-${eventId}.csv`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PositionCounts({ title, counts }: { title: string; counts: Partial<Record<Position, number>> }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>
        {POSITIONS.map((position) => <li key={position}>{position}: {counts[position] ?? 0}</li>)}
      </ul>
    </section>
  );
}

type CorrectionValues = Pick<RosterRegistrationDTO, 'dateOfBirth' | 'memberAssociation'>;

export function RosterPage({ client, eventId }: { client: Client; eventId: string }) {
  const [roster, setRoster] = useState<RosterDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correction, setCorrection] = useState<CorrectionValues | null>(null);
  const [associations, setAssociations] = useState<MemberAssociationDTO[] | null>(null);
  const [loadingAssociations, setLoadingAssociations] = useState(false);
  const [associationError, setAssociationError] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<string | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<'remove' | 'duplicate' | null>(null);
  const [removalReason, setRemovalReason] = useState('');
  const [removalNote, setRemovalNote] = useState('');
  const [retainedId, setRetainedId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [planningGaps, setPlanningGaps] = useState<PlannerGapDTO[]>([]);
  const [savingAction, setSavingAction] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    client.getRoster(eventId)
      .then((result) => { if (active) setRoster(result); })
      .catch(() => { if (active) setError('Could not load the roster. Check your connection and retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  async function loadAssociations() {
    setLoadingAssociations(true);
    setAssociationError(null);
    try {
      setAssociations((await client.listAssociations()).filter((association) => association.active));
    } catch {
      setAssociationError('Could not load active member associations. Retry to continue.');
    } finally {
      setLoadingAssociations(false);
    }
  }

  function startCorrection(registration: RosterRegistrationDTO) {
    setEditingId(registration.id);
    setCorrection({ dateOfBirth: registration.dateOfBirth, memberAssociation: registration.memberAssociation });
    setCorrectionReason('');
    setCorrectionError(null);
    setCorrectionStatus(null);
    if (associations === null) void loadAssociations();
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>, original: RosterRegistrationDTO) {
    event.preventDefault();
    if (!correction) return;
    if (correctionReason.trim().length < 3) {
      setCorrectionError('Record who confirmed this correction and how.');
      return;
    }
    const patch: { dateOfBirth?: string; memberAssociation?: string; reason: string } = { reason: correctionReason.trim() };
    if (correction.dateOfBirth !== original.dateOfBirth) patch.dateOfBirth = correction.dateOfBirth;
    if (correction.memberAssociation !== original.memberAssociation) patch.memberAssociation = correction.memberAssociation;
    if (Object.keys(patch).length === 0) {
      setCorrectionError('Change the player date of birth or member association before saving.');
      return;
    }

    setSavingCorrection(true);
    setCorrectionError(null);
    try {
      const updated = await client.correctRegistration(eventId, original.id, patch);
      setRoster((current) => current ? {
        ...current,
        registrations: current.registrations.map((registration) => registration.id === updated.id ? updated : registration),
      } : current);
      setEditingId(null);
      setCorrection(null);
      setCorrectionStatus(`${updated.playerName}'s registration details corrected.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setCorrectionError('There is already an active registration for this exact player name and date of birth in this event.');
      } else if (err instanceof ApiError && err.status === 422) {
        setCorrectionError('That date of birth is outside the age range recorded in this registration’s policy snapshot.');
      } else if (err instanceof ApiError && err.status === 400) {
        if (err.fields?.includes('dateOfBirth')) setCorrectionError('Enter a valid date of birth.');
        else if (err.fields?.includes('memberAssociation')) setCorrectionError('Choose an active member association.');
        else setCorrectionError('Check the corrected registration details and try again.');
      } else if (err instanceof ApiError && err.status === 404) {
        setCorrectionError('This registration no longer exists. Reload the roster before trying again.');
      } else {
        setCorrectionError('Could not correct the registration. Check your connection and try again.');
      }
    } finally {
      setSavingCorrection(false);
    }
  }

  function beginAction(registration: RosterRegistrationDTO, mode: 'remove' | 'duplicate') {
    setActionId(registration.id);
    setActionMode(mode);
    setRemovalReason('');
    setRemovalNote('');
    setRetainedId('');
    setActionError(null);
    setActionStatus(null);
    setPlanningGaps([]);
  }

  function showPlanning(planning: PlanningChangeDTO, savedMessage: string) {
    setPlanningGaps(planning.gaps);
    setActionStatus(planning.draftPlanId ? `${savedMessage} A new future-round draft is ready for review.` : savedMessage);
  }

  async function completeArrival(registration: RosterRegistrationDTO) {
    setSavingAction(true);
    setActionError(null);
    setActionStatus(null);
    setPlanningGaps([]);
    try {
      const result = await client.completeLateArrival(eventId, registration.id);
      setRoster((current) => current ? {
        ...current,
        registrations: current.registrations.map((row) => row.id === registration.id
          ? { ...row, bibNumber: result.bibNumber ?? row.bibNumber, checkedInAt: new Date().toISOString() }
          : row),
      } : current);
      showPlanning(result.planning, `${registration.playerName} is checked in. Attendance was saved.`);
    } catch {
      setActionError('Could not complete this late arrival. Confirm payment and email verification, then try again.');
    } finally {
      setSavingAction(false);
    }
  }

  async function saveRosterAction(event: FormEvent<HTMLFormElement>, registration: RosterRegistrationDTO) {
    event.preventDefault();
    if (actionMode === 'remove' && removalReason === '') return;
    if (actionMode === 'remove' && removalReason === 'Other' && !removalNote.trim()) {
      setActionError('A note is required when the removal reason is Other.');
      return;
    }
    if (actionMode === 'duplicate' && !retainedId) {
      setActionError('Choose the retained registration.');
      return;
    }
    setSavingAction(true);
    setActionError(null);
    setPlanningGaps([]);
    try {
      const result = actionMode === 'remove'
        ? await client.removeRegistration(eventId, registration.id, { reason: removalReason, note: removalNote })
        : await client.markRegistrationDuplicate(eventId, registration.id, {
            duplicateOfRegistrationId: retainedId, reason: 'Duplicate', note: removalNote,
          });
      setRoster((current) => current ? {
        ...current,
        registrations: current.registrations.map((row) => row.id === registration.id ? {
          ...row,
          status: result.status,
          removedAt: new Date().toISOString(),
          removalReason: actionMode === 'remove' ? removalReason : 'Duplicate',
          removalNote,
          duplicateOfRegistrationId: actionMode === 'duplicate' ? retainedId : row.duplicateOfRegistrationId,
        } : row),
      } : current);
      setActionId(null);
      setActionMode(null);
      showPlanning(result.planning, `${registration.playerName} was removed from future planning. Registration and payment history were preserved.`);
    } catch {
      setActionError('Could not save this roster change. Confirm the reason and retained registration, then try again.');
    } finally {
      setSavingAction(false);
    }
  }

  async function download() {
    setDownloading(true);
    setExportError(null);
    try {
      const blob = await client.downloadRoster(eventId);
      saveCsv(blob, eventId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setExportError('The roster export period has ended under the data-retention policy.');
      } else {
        setExportError('Could not download the roster. Your browser may have blocked the download; try again.');
      }
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <p role="status">Loading roster...</p>;
  if (error) {
    return (
      <section>
        <h1>Event roster</h1>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button>
      </section>
    );
  }
  if (!roster) return null;

  return (
    <section className="roster-page">
      <h1>Event roster</h1>
      <section aria-labelledby="position-counts-heading">
        <h2 id="position-counts-heading">Position choices</h2>
        <div className="position-counts">
          <PositionCounts title="First choice" counts={roster.positionCounts.rank1} />
          <PositionCounts title="Second choice" counts={roster.positionCounts.rank2} />
          <PositionCounts title="Third choice" counts={roster.positionCounts.rank3} />
          <p>Opted in to extra positions: {roster.positionCounts.extraOptIn}</p>
        </div>
      </section>
      <p><button type="button" disabled={downloading} onClick={download}>{downloading ? 'Preparing CSV...' : 'Download roster CSV'}</button></p>
      {exportError ? <p role="alert">{exportError}</p> : null}
      {correctionStatus ? <p className="message-confirmation" role="status">{correctionStatus}</p> : null}
      {actionStatus ? <p className="message-confirmation" role="status">{actionStatus}</p> : null}
      {!actionId && actionError ? <p role="alert">{actionError}</p> : null}
      {planningGaps.length > 0 ? <div role="alert"><h2>Future plan needs attention</h2><ul>{planningGaps.map((gap, index) => <li key={`${gap.code}-${index}`}>{gap.message}</li>)}</ul><p>Completed rounds and saved attendance were not changed.</p></div> : null}
      {roster.registrations.length === 0 ? <p>No registrations for this event.</p> : (
        <>
          <p className="scroll-region-note">Scroll horizontally to view all roster details.</p>
          <div className="table-scroll" role="region" aria-label="Event roster" tabIndex={0}>
            <table className="roster-table">
              <caption>Registrations, payment status and trial-day attendance</caption>
              <thead>
                <tr><th scope="col">Player</th><th scope="col">Number</th><th scope="col">Parent or guardian</th><th scope="col">Association</th><th scope="col">Positions</th><th scope="col">Payment</th><th scope="col">Check-in</th><th scope="col">History</th></tr>
              </thead>
              <tbody>
                {roster.registrations.map((registration) => {
                  const amount = formatFee(registration.amountCents, registration.currency);
                  const positions = [registration.rank1Position, registration.rank2Position, registration.rank3Position].filter(Boolean).join(', ');
                  const attendance = registration.checkedInAt ? 'Checked in'
                    : registration.bibNumber !== null ? 'Check-in undone'
                      : registration.status === 'PAID' ? 'No-show' : 'Not checked in';
                  const currentAssociationInactive = associations !== null && !associations.some((association) => association.name === registration.memberAssociation);
                  return (
                    <Fragment key={registration.id}>
                      <tr>
                        <th scope="row">
                          {registration.playerName}{registration.ageFlagged ? <span> · review flagged</span> : null}
                          <br /><span>Date of birth: {registration.dateOfBirth}</span>
                          <br /><button type="button" aria-label={`Correct details for ${registration.playerName}`} onClick={() => startCorrection(registration)}>Correct details</button>
                          {registration.status === 'PAID' && !registration.checkedInAt ? <><br /><button type="button" disabled={savingAction} aria-label={`Complete late arrival for ${registration.playerName}`} onClick={() => void completeArrival(registration)}>Complete late arrival</button></> : null}
                          {registration.status !== 'WITHDRAWN' && registration.status !== 'DUPLICATE' ? <>
                            <br /><button type="button" className="button-secondary" aria-label={`Remove player ${registration.playerName}`} onClick={() => beginAction(registration, 'remove')}>Remove player</button>
                            <br /><button type="button" className="button-secondary" aria-label={`Mark duplicate for ${registration.playerName} (${registration.parentEmail})`} onClick={() => beginAction(registration, 'duplicate')}>Mark duplicate</button>
                          </> : null}
                        </th>
                        <td>{registration.bibNumber ?? 'Not assigned'}</td>
                        <td>{registration.parentName}<br /><a href={`mailto:${registration.parentEmail}`}>{registration.parentEmail}</a><br />{registration.parentMobile}</td>
                        <td>{registration.memberAssociation}</td>
                        <td>{positions}{registration.optInExtraPositions ? ' · extra positions opted in' : ''}</td>
                        <td>{registration.status}<br />{amount}</td>
                        <td>{attendance}</td>
                        <td><Link to={`/admin/events/${eventId}/roster/${registration.id}/changes`}>View changes</Link></td>
                      </tr>
                      {actionId === registration.id && actionMode ? (
                        <tr className="roster-correction-row">
                          <td colSpan={8}>
                            <form onSubmit={(event) => void saveRosterAction(event, registration)}>
                              <h3>{actionMode === 'remove' ? `Remove ${registration.playerName}` : `Mark ${registration.playerName} as a duplicate`}</h3>
                              <p><strong>No automatic refund:</strong> removing a paid player does not refund the payment. The club must handle any refund separately.</p>
                              {actionError ? <p role="alert">{actionError}</p> : null}
                              {actionMode === 'remove' ? <>
                                <p><label htmlFor={`removal-reason-${registration.id}`}>Removal reason</label><select id={`removal-reason-${registration.id}`} required value={removalReason} onChange={(event) => setRemovalReason(event.target.value)}>
                                  <option value="">Choose a reason</option>
                                  <option>Duplicate</option><option>Unable to attend</option><option>Late withdrawal</option><option>Ineligible correction</option><option>Did not arrive</option><option>Other</option>
                                </select></p>
                                <p><label htmlFor={`removal-note-${registration.id}`}>Reason note</label><textarea id={`removal-note-${registration.id}`} maxLength={2000} aria-required={removalReason === 'Other'} value={removalNote} onChange={(event) => setRemovalNote(event.target.value)} /></p>
                              </> : <>
                                <p><label htmlFor={`retained-${registration.id}`}>Retained registration</label><select id={`retained-${registration.id}`} required value={retainedId} onChange={(event) => setRetainedId(event.target.value)}>
                                  <option value="">Choose the registration to retain</option>
                                  {roster.registrations.filter((candidate) => candidate.id !== registration.id &&
                                    (candidate.status === 'PENDING' || candidate.status === 'PAID') && !candidate.ageFlagged && !candidate.removedAt &&
                                    candidate.playerName.toLocaleLowerCase() === registration.playerName.toLocaleLowerCase() && candidate.dateOfBirth === registration.dateOfBirth
                                  ).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.playerName} ({candidate.parentEmail})</option>)}
                                </select></p>
                                <p><label htmlFor={`duplicate-note-${registration.id}`}>Duplicate note (optional)</label><textarea id={`duplicate-note-${registration.id}`} maxLength={2000} value={removalNote} onChange={(event) => setRemovalNote(event.target.value)} /></p>
                              </>}
                              <p><button type="submit" disabled={savingAction}>{actionMode === 'remove' ? 'Confirm removal' : 'Confirm duplicate'}</button> <button type="button" className="button-secondary" disabled={savingAction} onClick={() => { setActionId(null); setActionMode(null); }}>Cancel</button></p>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                      {editingId === registration.id && correction ? (
                        <tr className="roster-correction-row">
                          <td colSpan={8}>
                            <form className="roster-correction-form" onSubmit={(event) => saveCorrection(event, registration)}>
                              <h3>Correct registration details for {registration.playerName}</h3>
                              <p>Payment, Number and check-in details will not change.</p>
                              {associationError ? (
                                <p role="alert">{associationError} <button type="button" onClick={() => void loadAssociations()}>Retry</button></p>
                              ) : null}
                              {correctionError ? <p role="alert">{correctionError}</p> : null}
                              <div className="roster-correction-fields">
                                <p>
                                  <label htmlFor={`correction-dob-${registration.id}`}>Player date of birth</label>
                                  <input id={`correction-dob-${registration.id}`} type="date" required max={melbourneDateKey(new Date())} value={correction.dateOfBirth} onChange={(event) => setCorrection({ ...correction, dateOfBirth: event.target.value })} />
                                </p>
                                <p>
                                  <label htmlFor={`correction-association-${registration.id}`}>Member association</label>
                                  <select id={`correction-association-${registration.id}`} required disabled={loadingAssociations || associations === null} value={correction.memberAssociation} onChange={(event) => setCorrection({ ...correction, memberAssociation: event.target.value })}>
                                    {currentAssociationInactive ? <option value={registration.memberAssociation} disabled>{registration.memberAssociation} (inactive)</option> : null}
                                    {associations?.map((association) => <option key={association.id} value={association.name}>{association.name}</option>)}
                                  </select>
                                  {loadingAssociations ? <span>Loading active member associations...</span> : null}
                                </p>
                              </div>
                              <p><label htmlFor={`correction-reason-${registration.id}`}>Who confirmed the correction and how?</label><input id={`correction-reason-${registration.id}`} required minLength={3} maxLength={500} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="For example: confirmed by guardian on 12 September by phone" /></p>
                              <p className="roster-correction-actions">
                                <button type="submit" disabled={savingCorrection || loadingAssociations}>{savingCorrection ? 'Saving...' : 'Save correction'}</button>
                                <button className="button-secondary" type="button" disabled={savingCorrection} onClick={() => { setEditingId(null); setCorrection(null); setCorrectionError(null); }}>Cancel</button>
                              </p>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
