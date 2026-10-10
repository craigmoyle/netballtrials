import { useEffect, useState } from 'react';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function SheetsPage({ client, eventId }: { client: Client; eventId: string }) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let active = true;
    client
      .getSheetsHtml(eventId)
      .then((loaded) => {
        if (active) setHtml(loaded);
      })
      .catch(() => {
        if (active) setHtml('');
      });
    return () => {
      active = false;
    };
  }, [client, eventId]);

  return (
    <section>
      <p className="no-print">
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </p>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
