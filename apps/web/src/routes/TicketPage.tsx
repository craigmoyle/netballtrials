import { useEffect, useState } from 'react';
import type { TicketDTO } from '@netball-trials/types';
import type { apiClient } from '../api/client';

type Client = ReturnType<typeof apiClient>;

export function TicketPage({ client, token }: { client: Client; token: string }) {
  const [ticket, setTicket] = useState<TicketDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getTicket(token)
      .then((loaded) => { if (active) setTicket(loaded); })
      .catch(() => { if (active) setError('Ticket not found. Check the link in your confirmation email.'); });
    return () => { active = false; };
  }, [client, token]);

  if (error) return <p role="alert">{error}</p>;
  if (!ticket) return <p role="status">Loading ticket...</p>;

  return (
    <section className="public-page">
      <h1>{ticket.playerName}</h1>
      <p>{ticket.event.name}</p>
      {ticket.event.eventDate ? <p>{ticket.event.eventDate.slice(0, 10)}</p> : null}
      {ticket.event.startTime ? <p>Arrival {ticket.event.startTime}</p> : null}
      {ticket.event.firstWhistle ? <p>First whistle {ticket.event.firstWhistle}</p> : null}
      {ticket.event.venue ? <p>{ticket.event.venue}</p> : null}
      {ticket.bibNumber ? <p>Bib {ticket.bibNumber}</p> : null}
      <img className="ticket-qr" src={ticket.qrCode} alt={`Check-in QR code for ${ticket.playerName}`} />
      <p>Show this QR code to a volunteer at check-in.</p>
      <p><a href={client.ticketCalendarUrl(token)} download>Download calendar invite</a></p>
    </section>
  );
}
