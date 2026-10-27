import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MemberAssociationDTO } from '@netball-trials/types';
import { ApiError, type ApiClient as Client } from '../api/client';

type ContactDraft = { name: string; email: string };

function validContactPair(name: string, email: string): boolean {
  return Boolean(name.trim()) === Boolean(email.trim());
}

export function AssociationsPage({ client }: { client: Client }) {
  const [associations, setAssociations] = useState<MemberAssociationDTO[] | null>(null);
  const [name, setName] = useState('');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [contactDrafts, setContactDrafts] = useState<Record<string, ContactDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
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
    if (!validContactPair(primaryContactName, primaryContactEmail)) {
      setError('Enter both primary contact fields, or leave both blank.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const created = await client.createAssociation({
        name: name.trim(),
        primaryContactName: primaryContactName.trim() || null,
        primaryContactEmail: primaryContactEmail.trim() || null,
      });
      setAssociations((items) => [...(items ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setPrimaryContactName('');
      setPrimaryContactEmail('');
      setMessage(`${created.name} added.`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'That association already exists.' : 'Could not add the association. Your entry is still here; try again.');
    }
  }

  function draftFor(association: MemberAssociationDTO): ContactDraft {
    return contactDrafts[association.id] ?? {
      name: association.primaryContactName ?? '',
      email: association.primaryContactEmail ?? '',
    };
  }

  function updateContactDraft(associationId: string, patch: Partial<ContactDraft>) {
    const association = associations?.find((item) => item.id === associationId);
    if (!association) return;
    setContactDrafts((current) => ({
      ...current,
      [associationId]: { ...draftFor(association), ...current[associationId], ...patch },
    }));
  }

  async function saveContact(event: FormEvent, association: MemberAssociationDTO) {
    event.preventDefault();
    const draft = draftFor(association);
    if (!validContactPair(draft.name, draft.email)) {
      setError('Enter both primary contact fields, or leave both blank.');
      return;
    }
    setBusyId(association.id);
    setError(null);
    setMessage(null);
    try {
      const updated = await client.updateAssociation(association.id, {
        primaryContactName: draft.name.trim() || null,
        primaryContactEmail: draft.email.trim() || null,
      });
      setAssociations((items) => items?.map((item) => item.id === updated.id ? updated : item) ?? []);
      setContactDrafts((current) => ({ ...current, [association.id]: { name: updated.primaryContactName ?? '', email: updated.primaryContactEmail ?? '' } }));
      setMessage(`Primary contact saved for ${association.name}.`);
    } catch {
      setError(`Could not save the primary contact for ${association.name}. Your changes are still here; try again.`);
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(association: MemberAssociationDTO) {
    setBusyId(association.id);
    setError(null);
    setMessage(null);
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
    return <section><h1>Member associations</h1><p role="alert">{error ?? 'Association list unavailable.'}</p><button type="button" onClick={() => void load()}>Retry</button></section>;
  }

  return (
    <section>
      <h1>Member associations</h1>
      <p>Only active associations are available to parents during registration. Primary contacts are used for association communications and are not shown to families or volunteers.</p>
      <p><Link to="/admin/events">Back to events</Link></p>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <form onSubmit={(event) => void add(event)}>
        <fieldset className="form-group">
          <legend>New member association</legend>
          <p><label htmlFor="associationName">Association name</label><input id="associationName" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></p>
          <p><label htmlFor="new-primary-contact-name">Primary contact name (optional)</label><input id="new-primary-contact-name" maxLength={120} value={primaryContactName} onChange={(event) => setPrimaryContactName(event.target.value)} /></p>
          <p><label htmlFor="new-primary-contact-email">Primary contact email (optional)</label><input id="new-primary-contact-email" type="email" maxLength={320} value={primaryContactEmail} onChange={(event) => setPrimaryContactEmail(event.target.value)} /></p>
          <button type="submit" disabled={!name.trim()}>Add association</button>
        </fieldset>
      </form>
      {associations.length === 0 ? <p>No associations yet.</p> : (
        <ul className="association-list">
          {associations.map((association) => {
            const draft = draftFor(association);
            return (
              <li key={association.id}>
                <h2>{association.name} — {association.active ? 'Active' : 'Inactive'}</h2>
                <form onSubmit={(event) => void saveContact(event, association)}>
                  <p><label htmlFor={`contact-name-${association.id}`}>Primary contact name</label><input id={`contact-name-${association.id}`} maxLength={120} value={draft.name} onChange={(event) => updateContactDraft(association.id, { name: event.target.value })} /></p>
                  <p><label htmlFor={`contact-email-${association.id}`}>Primary contact email</label><input id={`contact-email-${association.id}`} type="email" maxLength={320} value={draft.email} onChange={(event) => updateContactDraft(association.id, { email: event.target.value })} /></p>
                  <button type="submit" disabled={busyId === association.id}>Save contact</button>{' '}
                  <button type="button" disabled={busyId === association.id} onClick={() => void toggle(association)}>
                    {busyId === association.id ? 'Saving...' : association.active ? `Deactivate ${association.name}` : `Activate ${association.name}`}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
