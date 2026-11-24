import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { POSITIONS, melbourneDateKey, type MemberAssociationDTO, type Position, type RosterDTO, type RosterRegistrationDTO } from '@netball-trials/types';
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
  const [savingCorrection, setSavingCorrection] = useState(false);

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
    setCorrectionError(null);
    setCorrectionStatus(null);
    if (associations === null) void loadAssociations();
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>, original: RosterRegistrationDTO) {
    event.preventDefault();
    if (!correction) return;
    const patch: { dateOfBirth?: string; memberAssociation?: string } = {};
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
                        </th>
                        <td>{registration.bibNumber ?? 'Not assigned'}</td>
                        <td>{registration.parentName}<br /><a href={`mailto:${registration.parentEmail}`}>{registration.parentEmail}</a><br />{registration.parentMobile}</td>
                        <td>{registration.memberAssociation}</td>
                        <td>{positions}{registration.optInExtraPositions ? ' · extra positions opted in' : ''}</td>
                        <td>{registration.status}<br />{amount}</td>
                        <td>{attendance}</td>
                        <td><Link to={`/admin/events/${eventId}/roster/${registration.id}/changes`}>View changes</Link></td>
                      </tr>
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
