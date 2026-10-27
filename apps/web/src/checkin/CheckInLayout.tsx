import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { CheckInSummary } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { CHECK_IN_UPDATED_EVENT } from './refresh';
import { ClubLogoLink } from '../SiteNavigation';
import { checkInSessionEnded } from './session';

export function CheckInLayout({ client }: { client: Client }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    let active = true;
    const load = () => {
      const requestId = ++latestRequest.current;
      const current = () => active && requestId === latestRequest.current;
      client
        .checkInSummary()
        .then((loaded) => {
          if (!current()) return;
          if (loaded.closed) navigate('/check-in', { replace: true });
          else setSummary(loaded);
        })
        .catch((error) => {
          // Only a rejected check-in session ends the volunteer's session; transient
          // failures keep the last summary on screen.
          if (current() && checkInSessionEnded(error, true)) {
            navigate('/check-in', { replace: true });
          }
        });
    };
    load();
    const refreshInterval = window.setInterval(load, 15_000);
    window.addEventListener(CHECK_IN_UPDATED_EVENT, load);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener(CHECK_IN_UPDATED_EVENT, load);
    };
  }, [client, navigate]);

  return (
    <header className="app-header checkin-header">
      <ClubLogoLink />
      <h1>{summary ? summary.eventName : 'Check-in'}</h1>
      {summary ? (
        <p>
          {summary.checkedIn} of {summary.registered} arrived
        </p>
      ) : null}
      <nav className="app-nav" aria-label="Check-in">
        <Link to="/check-in/scan" aria-current={pathname === '/check-in/scan' ? 'page' : undefined}>Scan</Link>
        <Link to="/check-in/lookup" aria-current={pathname === '/check-in/lookup' ? 'page' : undefined}>Lookup</Link>
      </nav>
    </header>
  );
}
