import { useEffect, useState, type FormEvent } from 'react';
import type { BibColorDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';

export function BibColorsPage({ client }: { client: Client }) {
  const [colors, setColors] = useState<BibColorDTO[] | null>(null);
  const [loadingError, setLoadingError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState('');
  const [hex, setHex] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editHex, setEditHex] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingError(false);
    client.listBibColors()
      .then((loaded) => { if (active) setColors(loaded); })
      .catch(() => { if (active) setLoadingError(true); });
    return () => { active = false; };
  }, [client, retry]);

  async function addColor(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await client.createBibColor({ name, hex });
      setColors((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setHex('');
      setMessage(`${created.name} added to the color catalog.`);
    } catch (reason) {
      if ((reason as { status?: number }).status === 409) setError('A color with that name already exists. Choose another name.');
      else if ((reason as { status?: number }).status === 400) setError('Enter a color name and a six-digit hex value such as #12AB34.');
      else setError('Could not add this color. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(color: BibColorDTO) {
    setEditingId(color.id);
    setEditName(color.name);
    setEditHex(color.hex);
    setError(null);
    setMessage(null);
  }

  async function saveEdit(color: BibColorDTO) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await client.updateBibColor(color.id, { name: editName, hex: editHex });
      setColors((current) => current?.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.name.localeCompare(b.name)) ?? null);
      setEditingId(null);
      setMessage(`${updated.name} updated.`);
    } catch (reason) {
      if ((reason as { status?: number }).status === 409) setError('A color with that name already exists. Choose another name.');
      else if ((reason as { status?: number }).status === 400) setError('Enter a color name and a six-digit hex value such as #12AB34.');
      else setError('Could not update this color. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function archive(color: BibColorDTO) {
    if (!window.confirm(`Archive ${color.name}? Existing event assignments will keep using it.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await client.archiveBibColor(color.id);
      setColors((current) => current?.map((item) => item.id === color.id ? { ...item, archivedAt: new Date().toISOString() } : item) ?? null);
      setMessage(`${color.name} archived. Existing event assignments are unchanged.`);
    } catch {
      setError('Could not archive this color. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loadingError) {
    return (
      <section>
        <h1>Bib colors</h1>
        <p role="alert">Could not load the color catalog. Check your connection and retry.</p>
        <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button>
      </section>
    );
  }
  if (!colors) return <p role="status">Loading bib colors...</p>;

  return (
    <section>
      <h1>Bib colors</h1>
      <p>Archived colors cannot be selected for new court assignments; existing event assignments remain unchanged.</p>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <form onSubmit={addColor}>
        <p>
          <label htmlFor="new-color-name">Color name</label>
          <input id="new-color-name" value={name} onChange={(event) => setName(event.target.value)} />
        </p>
        <p>
          <label htmlFor="new-color-hex">Color hex</label>
          <input id="new-color-hex" value={hex} placeholder="#12AB34" onChange={(event) => setHex(event.target.value)} />
        </p>
        <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Add color'}</button>
      </form>
      {colors.length === 0 ? <p>No colors in the catalog yet.</p> : (
        <div className="table-scroll" role="region" aria-label="Club bib colors" tabIndex={0}>
          <table>
            <caption>Club bib colors</caption>
            <thead><tr><th scope="col">Swatch</th><th scope="col">Color</th><th scope="col">Hex</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {colors.map((color) => (
                <tr key={color.id}>
                  <td><span className="bib-color-swatch" role="img" aria-label={`${color.name} color swatch`} style={{ backgroundColor: color.hex }} /></td>
                  <th scope="row">{editingId === color.id
                    ? <input aria-label={`Color name for ${color.name}`} value={editName} onChange={(event) => setEditName(event.target.value)} />
                    : color.name}</th>
                  <td>{editingId === color.id
                    ? <input aria-label={`Color hex for ${color.name}`} value={editHex} onChange={(event) => setEditHex(event.target.value)} />
                    : color.hex}</td>
                  <td>{color.archivedAt ? 'Archived' : 'Active'}</td>
                  <td>
                    {editingId === color.id ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => saveEdit(color)}>Save {color.name}</button>{' '}
                        <button type="button" disabled={busy} onClick={() => setEditingId(null)}>Cancel {color.name}</button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={busy} onClick={() => beginEdit(color)}>Edit {color.name}</button>{' '}
                        {!color.archivedAt ? <button type="button" disabled={busy} onClick={() => archive(color)}>Archive {color.name}</button> : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
