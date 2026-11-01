import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RegistrationOverviewEventDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';
import { HelpTip } from './HelpTip';

export function RegistrationOverviewPage({ client }: { client: Client }) {
  const [events, setEvents] = useState<RegistrationOverviewEventDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    client.getRegistrationOverview()
      .then((loaded) => { if (active) setEvents(loaded); })
      .catch(() => { if (active) setError('Could not load registration totals. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, retry]);

  return (
    <section className="registration-overview-page">
      <div className="admin-page-title-row"><h1>Registration overview</h1><HelpTip label="How the comparison works">The difference compares total payments, including paid withdrawals, with previous events at the same time before their start. The Paid column shows active registrations; withdrawals are listed separately.</HelpTip></div>
      <p>Track paid sign-ups for open events against previous years at the same point before each trial. Pending registrations and paid withdrawals are shown separately.</p>
      {loading ? <p role="status">Loading registration totals…</p> : null}
      {!loading && error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((count) => count + 1)}>Retry</button></div> : null}
      {!loading && !error && events.length === 0 ? (
        <p>No events are currently open for registration. <Link to="/admin/events">View events</Link></p>
      ) : null}
      {!loading && !error && events.length > 0 ? (
        <>
          <p>Counts are registrations, not families. Paid shows active players and paid withdrawals are separate. The trend compares total payments with previous years at the same point, including registrations later withdrawn.</p>
          <div className="table-scroll" role="region" aria-label="Open event registration totals" tabIndex={0}>
            <table className="registration-overview-table">
              <caption>Open event registration totals</caption>
              <thead><tr><th scope="col">Event</th><th scope="col">Trial date</th><th scope="col">Days before start</th><th scope="col">Paid</th><th scope="col">Paid withdrawals</th><th scope="col">Pending</th><th scope="col">Prior-year average</th><th scope="col">Difference from average</th></tr></thead>
              <tbody>{events.map((event) => {
                const priorAverage = event.priorYears.length
                  ? Math.round(event.priorYears.reduce((total, prior) => total + prior.paidRegistrationsAtSameLeadTime, 0) / event.priorYears.length)
                  : null;
                const difference = priorAverage === null ? null : event.paidRegistrations + event.paidWithdrawals - priorAverage;
                return (
                  <tr key={event.id}>
                    <th scope="row"><Link to={`/admin/events/${event.id}/roster`}>{event.name}</Link><span className="registration-overview-division">{event.division} · {event.section} · {event.competitionYear}</span></th>
                    <td>{formatTrialDate(event.eventDate)}</td>
                    <td>{event.daysUntilStart === 0 ? 'Today' : event.daysUntilStart}</td>
                    <td>{event.paidRegistrations}</td>
                    <td>{event.paidWithdrawals}</td>
                    <td>{event.pendingRegistrations}</td>
                    <td>{priorAverage ?? 'No comparison'}</td>
                    <td>{difference === null ? '—' : difference === 0 ? 'At average' : `${Math.abs(difference)} ${difference > 0 ? 'more' : 'fewer'}`}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {events.map((event) => (
            <details className="registration-overview-history" key={`${event.id}-history`}>
              <summary>{event.division} {event.section}: previous years</summary>
              {event.priorYears.length > 0 ? (
                <div className="table-scroll" role="region" aria-label={`${event.competitionYear} ${event.division} previous years`} tabIndex={0}>
                  <table>
                    <caption>Paid registrations at the same lead time as {event.competitionYear}</caption>
                    <thead><tr><th scope="col">Competition year</th><th scope="col">Paid by this point</th></tr></thead>
                    <tbody>{event.priorYears.map((prior) => <tr key={prior.competitionYear}><th scope="row">{prior.competitionYear}</th><td>{prior.paidRegistrationsAtSameLeadTime}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <p>No comparable events are available within the application’s retention period.</p>}
            </details>
          ))}
        </>
      ) : null}
    </section>
  );
}
