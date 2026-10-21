import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type ApiClient as Client } from '../api/client';

export function SheetsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setHtml(null);
    setError(null);
    void (async () => {
      try {
        const plan = await client.getPublishedPlan(eventId);
        if (!active) return;
        if (!plan || plan.status !== 'PUBLISHED') {
          setError('Publish a plan before printing selector sheets.');
          return;
        }
        const loaded = await client.getSheetsHtml(eventId);
        if (active) setHtml(loaded);
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 409 && reason.message === 'court_colors_unassigned') {
          setError('Team A and Team B colors must be set for every court in event settings before printing selector sheets.');
        } else setError('Could not load selector sheets. Try again.');
      }
    })();
    return () => { active = false; };
  }, [client, eventId, retry]);

  if (error) {
    return (
      <section className="no-print">
        <h1>Selector sheets</h1>
        <p role="alert">{error}</p>
        {error.includes('Publish a plan')
          ? <Link to={`/admin/events/${eventId}/plan`}>Review the round plan</Link>
          : error.startsWith('Team A and Team B colors')
            ? <Link to={`/admin/events/${eventId}`}>Event settings and court colors</Link>
            : <button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button>}
        {' '}<Link to={`/admin/events/${eventId}/sheets/blank`}>Download Blank Sheet</Link>
      </section>
    );
  }
  if (html === null) return <p role="status">Loading published selector sheets...</p>;

  return (
    <div className="sheets-page">
      <header className="no-print">
        <h1>Selector sheets</h1>
        <Link to={`/admin/events/${eventId}/plan`}>Back to round plan</Link>{' '}
        <Link to={`/admin/events/${eventId}/sheets/blank`}>Download Blank Sheet</Link>{' '}
        <button type="button" onClick={() => window.print()}>Print selector sheets</button>
      </header>
      <div className="sheet-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
