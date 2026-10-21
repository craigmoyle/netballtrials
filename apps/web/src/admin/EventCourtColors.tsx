import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BibColorDTO, EventCourtColorDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';

type Pair = { teamAColorId: string; teamBColorId: string };

function pairFrom(row: EventCourtColorDTO | undefined): Pair {
  return { teamAColorId: row?.teamAColor?.id ?? '', teamBColorId: row?.teamBColor?.id ?? '' };
}

export function EventCourtColors({ client, eventId, courts }: { client: Client; eventId: string; courts: number }) {
  const [colors, setColors] = useState<BibColorDTO[] | null>(null);
  const [assignments, setAssignments] = useState<EventCourtColorDTO[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Pair>>({});
  const [loadError, setLoadError] = useState(false);
  const [busyCourt, setBusyCourt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    Promise.all([client.listBibColors(), client.getCourtColors(eventId)])
      .then(([loadedColors, loadedAssignments]) => {
        if (!active) return;
        setColors(loadedColors);
        setAssignments(loadedAssignments);
        setDrafts(Object.fromEntries(Array.from({ length: courts }, (_, index) => {
          const court = index + 1;
          return [court, pairFrom(loadedAssignments.find((row) => row.court === court))];
        })));
      })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [client, eventId, courts]);

  function updateDraft(court: number, key: keyof Pair, value: string) {
    setDrafts((current) => ({ ...current, [court]: { ...(current[court] ?? pairFrom(undefined)), [key]: value } }));
    setError(null);
    setMessage(null);
  }

  async function save(court: number) {
    const pair = drafts[court] ?? pairFrom(undefined);
    setError(null);
    setMessage(null);
    if (!pair.teamAColorId || !pair.teamBColorId) {
      setError('Choose a color for Team A and Team B.');
      return;
    }
    if (pair.teamAColorId === pair.teamBColorId) {
      setError('Team A and Team B colors must be different.');
      return;
    }
    setBusyCourt(court);
    try {
      const saved = await client.setCourtColors(eventId, court, pair);
      setAssignments((current) => [...current.filter((row) => row.court !== court), saved].sort((a, b) => a.court - b.court));
      setDrafts((current) => ({ ...current, [court]: pairFrom(saved) }));
      setMessage(`Court ${court} colors saved.`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.message === 'archived_color') {
        setError('An archived color cannot be assigned to a new team. Choose an active color.');
      } else {
        setError('Could not save these court colors. Check your connection and try again.');
      }
    } finally {
      setBusyCourt(null);
    }
  }

  if (loadError) {
    return (
      <section className="event-court-colors" aria-labelledby="event-court-colors-heading">
        <h3 id="event-court-colors-heading">Team colors</h3>
        <p role="alert">Could not load the color catalog or court assignments. Refresh this page and try again.</p>
      </section>
    );
  }
  if (!colors) return <p role="status">Loading event court colors...</p>;

  return (
    <section className="event-court-colors" aria-labelledby="event-court-colors-heading">
      <h3 id="event-court-colors-heading">Team colors</h3>
      <p>Choose distinct bib colors for Team A and Team B on each court. Written names remain visible in grayscale.</p>
      {colors.filter((color) => !color.archivedAt).length === 0
        ? <p>No active colors. <Link to="/admin/bib-colors">Add bib colors</Link>.</p>
        : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="court-color-grid">
        {Array.from({ length: courts }, (_, index) => {
          const court = index + 1;
          const pair = drafts[court] ?? pairFrom(assignments.find((row) => row.court === court));
          const selection = (team: 'teamAColorId' | 'teamBColorId', label: string) => {
            const currentId = pair[team];
            const choices = colors.filter((color) => !color.archivedAt || color.id === currentId);
            const selected = colors.find((color) => color.id === currentId);
            return (
              <p key={team}>
                <label htmlFor={`court-${court}-${team}`}>Court {court} {label} color</label>
                <select id={`court-${court}-${team}`} value={currentId} onChange={(event) => updateDraft(court, team, event.target.value)}>
                  <option value="">Choose a color</option>
                  {choices.map((color) => <option key={color.id} value={color.id}>{color.name}{color.archivedAt ? ' (archived)' : ''}</option>)}
                </select>
                {selected ? <span className="bib-color-choice"><span className="bib-color-swatch" role="img" aria-label={`${selected.name} color swatch`} style={{ backgroundColor: selected.hex }} /> {selected.name}{selected.archivedAt ? ' (archived)' : ''}</span> : null}
              </p>
            );
          };
          return (
            <fieldset key={court} className="court-color-pair">
              <legend>Court {court}</legend>
              {selection('teamAColorId', 'Team A')}
              {selection('teamBColorId', 'Team B')}
              <button type="button" disabled={busyCourt !== null} onClick={() => save(court)}>Save court {court} colors</button>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
