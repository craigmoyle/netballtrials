import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RegistrationStatus, TicketDTO } from '@netball-trials/types';
import type { ApiClient as Client } from '../api/client';
import { formatTrialDate } from '../formatTrialDate';

export function RegistrationPendingPage({
  client,
  checkoutSessionId,
}: {
  client: Client;
  checkoutSessionId: string;
}) {
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [ticket, setTicket] = useState<TicketDTO | null>(null);
  const [ticketPath, setTicketPath] = useState<string | null>(null);
  const [calendarUrl, setCalendarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const result = await client.getRegistrationStatus(checkoutSessionId);
        if (!active) return;
        setStatus(result.status);
        setError(null);
        if (result.status === 'PAID') {
          setTicket(result.ticket ?? null);
          setTicketPath(result.ticketPath ?? null);
          setCalendarUrl(result.calendarUrl ?? null);
        } else if (result.status === 'PENDING') {
          timer = setTimeout(poll, 3000);
        }
      } catch {
        if (!active) return;
        setError('Could not check the payment status. You can retry here; do not pay again while the status is being checked.');
        timer = setTimeout(poll, 5000);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [client, checkoutSessionId, retry]);

  if (status === 'PAID') {
    return (
      <section className="public-page">
        <h1>Payment received</h1>
        {ticket ? (
          <>
            <p>{ticket.playerName} is registered for {ticket.event.name}.</p>
            <img className="ticket-qr" src={ticket.qrCode} alt={`Check-in QR code for ${ticket.playerName}`} />
            <p>{ticket.event.eventDate ? formatTrialDate(ticket.event.eventDate) : null} · arrival {ticket.event.startTime} · {ticket.event.venue}</p>
            {ticketPath ? <p><Link to={ticketPath}>Open ticket</Link></p> : null}
            {calendarUrl ? <p><a href={calendarUrl} download>Download calendar invite</a></p> : null}
          </>
        ) : (
          <p>Check your email for the QR ticket and calendar invite.</p>
        )}
        <p>Keep the QR code available for check-in. Do not share it with anyone else.</p>
        <p><Link to="/manage-registration">Manage registrations</Link></p>
      </section>
    );
  }

  if (status === 'EXPIRED' || status === 'FAILED') {
    return (
      <section className="public-page">
        <h1>Payment not completed</h1>
        <p>That checkout has closed. You can register again from the trial page.</p>
      </section>
    );
  }

  if (status === 'WITHDRAWN') {
    return (
      <section className="public-page">
        <h1>Registration not active</h1>
        <p>This registration is no longer active. Contact the club if you need help.</p>
      </section>
    );
  }

  return (
    <section className="public-page">
      <h1>Confirming your payment</h1>
      <p>Registration is not complete until email verification and payment are confirmed. This page updates automatically; do not start another payment while the status is pending.</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={() => { setError(null); setRetry((count) => count + 1); }}>Check payment again</button>
      <p><Link to="/manage-registration">Manage registrations</Link></p>
    </section>
  );
}
