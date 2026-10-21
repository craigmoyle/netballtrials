import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiClient as Client } from '../api/client';

export function BlankSheetPage({ client, eventId }: { client: Client; eventId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setHtml(null);
    setError(false);
    client.getBlankSheetHtml(eventId)
      .then((loaded) => { if (active) setHtml(loaded); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [client, eventId, retry]);

  if (error) {
    return (
      <section className="no-print">
        <h1>Blank game sheet</h1>
        <p role="alert">Could not load the blank game sheet. Try again.</p>
        <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button>{' '}
        <Link to={`/admin/events/${eventId}/sheets`}>Back to selector sheets</Link>
      </section>
    );
  }
  if (html === null) return <p role="status">Loading blank game sheet...</p>;

  return (
    <div className="sheets-page">
      <header className="no-print">
        <h1>Blank game sheet</h1>
        <Link to={`/admin/events/${eventId}/sheets`}>Back to selector sheets</Link>{' '}
        <button type="button" onClick={() => window.print()}>Print blank game sheet</button>
      </header>
      <div className="sheet-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
