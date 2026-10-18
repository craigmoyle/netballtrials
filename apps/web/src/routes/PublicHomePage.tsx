import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicTrialDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';

type Client = ReturnType<typeof apiClient>;

const CHISHOLM_HOME = 'https://chisholmnetball.com/';

function fee(trial: PublicTrialDTO): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: trial.currency.toUpperCase(),
  }).format(trial.registrationFeeCents / 100);
}

export function PublicHomePage({ client }: { client: Client }) {
  const [trials, setTrials] = useState<PublicTrialDTO[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError(false);
    client.listPublicEvents()
      .then((loaded) => { if (active) setTrials(loaded); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [client, retry]);

  return (
    <main className="public-home-main" aria-labelledby="upcoming-trials-heading">
      <div className="public-home-banner">
        <div className="public-home-banner-inner">
          <p className="public-home-club"><a href={CHISHOLM_HOME}>Chisholm Netball home</a></p>
          <h1 id="upcoming-trials-heading">Upcoming trials</h1>
        </div>
      </div>
      <div className="app-main">
        <div className="public-page">
          {error ? (
            <div role="alert">
              <p>Upcoming trials could not be loaded.</p>
              <button type="button" onClick={() => { setTrials(null); setRetry((count) => count + 1); }}>Try again</button>
            </div>
          ) : trials === null ? (
            <p role="status">Loading upcoming trials...</p>
          ) : trials.length === 0 ? (
            <p>No trials currently scheduled.</p>
          ) : (
            <ul className="public-trials">
              {trials.map((trial) => (
                <li key={trial.id}>
                  <article className="public-trial">
                    <div>
                      <h2>{trial.name}</h2>
                      <p className="public-trial-category">{trial.division} · {trial.section}</p>
                      <dl className="public-trial-details">
                        <div><dt>Date</dt><dd>{formatTrialDate(trial.eventDate)}</dd></div>
                        <div><dt>Venue</dt><dd>{trial.venue}</dd></div>
                        <div><dt>Arrival</dt><dd>{trial.startTime}</dd></div>
                        <div><dt>First whistle</dt><dd>{trial.firstWhistle}</dd></div>
                        <div><dt>Registration fee</dt><dd>{fee(trial)}</dd></div>
                      </dl>
                    </div>
                    <div className="public-trial-action">
                      {trial.status === 'OPEN' ? (
                        <Link className="public-register-link" to={`/register/${trial.id}`} aria-label={`Register for ${trial.name}`}>Register</Link>
                      ) : (
                        <span>Registration closed</span>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
