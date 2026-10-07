import type { EmailProvider } from '../mail/provider';
import { buildIcs } from './ics';
import { qrDataUrl } from './qr';

export type ConfirmationInput = {
  playerName: string;
  event: {
    name: string;
    eventDate: string;
    venue: string;
    firstWhistle: string;
  };
  ticketUrl: string;
  qrDataUrl: string;
  policyUrl: string;
  icsText: string;
};

export type ConfirmationEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildConfirmation(input: ConfirmationInput): ConfirmationEmail {
  const { playerName, event, ticketUrl, qrDataUrl, policyUrl } = input;
  const when = `${event.eventDate} at ${event.firstWhistle}`;

  const subject = `Trial registration confirmed: ${playerName} (${event.name})`;

  const text = [
    `${playerName} is registered for ${event.name}.`,
    `When: ${when}`,
    `Where: ${event.venue}`,
    '',
    `Your QR ticket: ${ticketUrl}`,
    `Selection policy: ${policyUrl}`,
    '',
    'A calendar file is attached so you can add the trial to your calendar.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body>
    <h1>Registration confirmed</h1>
    <p>${escapeHtml(playerName)} is registered for ${escapeHtml(event.name)}.</p>
    <p>When: ${escapeHtml(when)}<br />Where: ${escapeHtml(event.venue)}</p>
    <p><img src="${qrDataUrl}" alt="Check-in QR code" width="240" height="240" /></p>
    <p><a href="${ticketUrl}">Your QR ticket</a></p>
    <p><a href="${policyUrl}">Selection policy</a></p>
    <p>A calendar file is attached so you can add the trial to your calendar.</p>
  </body>
</html>`;

  return { subject, text, html };
}

export async function sendConfirmation(
  deps: { mailer: EmailProvider },
  registration: {
    id: string;
    playerFirstName: string;
    playerLastName: string;
    parentEmail: string;
    policyReference: string;
    qrToken: string | null;
  },
  event: { name: string; eventDate: Date; venue: string; firstWhistle: string },
  ticketUrl: string,
): Promise<void> {
  const eventDate = event.eventDate.toISOString().slice(0, 10);
  const icsText = buildIcs({
    uid: `${registration.id}@chisholmnetball.com`,
    title: `${event.name} trials`,
    start: new Date(`${eventDate}T${event.firstWhistle}:00.000Z`),
    end: new Date(`${eventDate}T${event.firstWhistle}:00.000Z`),
    location: event.venue,
    description: 'Bring your QR code to check in. Bib numbers are issued at the door.',
  });

  const email = buildConfirmation({
    playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    event: { name: event.name, eventDate, venue: event.venue, firstWhistle: event.firstWhistle },
    ticketUrl,
    qrDataUrl: await qrDataUrl(registration.qrToken ?? ''),
    policyUrl: registration.policyReference,
    icsText,
  });

  await deps.mailer.send({
    to: registration.parentEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
