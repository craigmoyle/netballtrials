import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MemberAssociationDTO } from '@netball-trials/types';
import { ApiError, type apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function AssociationsPage({ client }: { client: Client }) {
  const [associations, setAssociations] = useState<MemberAssociationDTO[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      setAssociations(await client.listAssociations());
    } catch {
      setError('Could not load member associations. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    client.listAssociations()
      .then((items) => { if (active) setAssociations(items); })
      .catch(() => { if (active) setError('Could not load member associations. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await client.createAssociation(name.trim());
      setAssociations((items) => [...(items ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'That association already exists.' : 'Could not add the association. Your entry is still here; try again.');
    }
  }

  async function toggle(association: MemberAssociationDTO) {
    setBusyId(association.id);
    setError(null);
    try {
      const updated = await client.setAssociationActive(association.id, !association.active);
      setAssociations((items) => items?.map((item) => item.id === updated.id ? updated : item) ?? []);
    } catch {
      setError(`Could not update ${association.name}. Try again.`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !associations) return <p role="status">Loading associations...</p>;
  if (!associations) {
    return <section><h1>Member associations</h1><p role="alert">{error ?? 'Association list unavailable.'}</p><button type="button" onClick={load}>Retry</button></section>;
  }

  return (
    <section>
      <h1>Member associations</h1>
      <p>Only active associations are available to parents during registration.</p>
      <p><Link to="/admin/events">Back to events</Link></p>
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={add}>
        <label htmlFor="associationName">New association name</label>
        <input id="associationName" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        <button type="submit" disabled={name.trim().length === 0}>Add association</button>
      </form>
      {associations.length === 0 ? <p>No associations yet.</p> : (
        <ul>
          {associations.map((association) => (
            <li key={association.id}>
              <strong>{association.name}</strong> — {association.active ? 'Active' : 'Inactive'}{' '}
              <button type="button" disabled={busyId === association.id} onClick={() => toggle(association)}>
                {busyId === association.id ? 'Saving...' : association.active ? `Deactivate ${association.name}` : `Activate ${association.name}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
