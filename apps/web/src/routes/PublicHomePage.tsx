import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicTrialDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { formatFee } from '../formatFee';
import { formatTrialDate } from '../formatTrialDate';

const CHISHOLM_HOME = 'https://chisholmnetball.com/';

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
    <main id="main-content" className="public-home-main" tabIndex={-1} aria-labelledby="upcoming-trials-heading">
      <div className="public-home-banner">
        <div className="public-home-banner-inner">
          <p className="public-home-club"><a href={CHISHOLM_HOME}>Chisholm Netball website</a></p>
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
                        <div><dt>Arrival time</dt><dd>{trial.startTime}</dd></div>
                        <div><dt>Start time</dt><dd>{trial.gameStartTime}</dd></div>
                        <div><dt>Registration fee</dt><dd>{formatFee(trial.registrationFeeCents, trial.currency)}</dd></div>
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
          <section aria-labelledby="registration-next-steps-heading">
            <h2 id="registration-next-steps-heading">After you register</h2>
            <p>After you submit, confirm the parent or guardian email, then complete secure Checkout. Registration is complete only after payment is confirmed. Use <Link to="/manage-registration">Manage registrations</Link> to return to sibling registrations or continue a pending payment.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
