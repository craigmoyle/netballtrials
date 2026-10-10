import type { PrismaClient } from '@prisma/client';
import type { EmailProvider } from '../mail/provider';
import { sendEmailToRecipient } from '../messages/service';
import { localDateTimeToUtc } from '../time/melbourne';
import { buildIcs } from './ics';
import { qrPng } from './qr';

export type ConfirmationInput = {
  playerName: string;
  event: {
    name: string;
    eventDate: string;
    venue: string;
    firstWhistle: string;
  };
  ticketUrl: string;
  qrCid: string;
  policyUrl: string;
};

export type ConfirmationEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export function buildConfirmation(input: ConfirmationInput): ConfirmationEmail {
  const { playerName, event, ticketUrl, qrCid, policyUrl } = input;
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
    <p><img src="cid:${escapeHtml(qrCid)}" alt="Check-in QR code" width="240" height="240" /></p>
    <p><a href="${escapeHtml(ticketUrl)}">Your QR ticket</a></p>
    <p><a href="${escapeHtml(policyUrl)}">Selection policy</a></p>
    <p>A calendar file is attached so you can add the trial to your calendar.</p>
  </body>
</html>`;
  return { subject, text, html };
}

export async function sendConfirmation(
  deps: { mailer: EmailProvider; prisma?: PrismaClient },
  registration: {
    id: string;
    playerFirstName: string;
    playerLastName: string;
    parentEmail: string;
    policyReference: string;
    qrToken: string | null;
  },
  event: {
    id: string;
    name: string;
    eventDate: Date;
    venue: string;
    startTime: string;
    endTime: string;
    firstWhistle: string;
  },
  ticketUrl: string,
  options: { batchId?: string } = {},
): Promise<void> {
  const eventDate = event.eventDate.toISOString().slice(0, 10);
  const calendar = buildIcs({
    uid: `${registration.id}@chisholmnetball.com`,
    title: `${event.name} trials`,
    start: localDateTimeToUtc(event.eventDate, event.startTime),
    end: localDateTimeToUtc(event.eventDate, event.endTime),
    location: event.venue,
    description: 'Bring your QR code to check in. Bib numbers are issued at the door.',
    stamp: new Date(),
  });
  const email = buildConfirmation({
    playerName: `${registration.playerFirstName} ${registration.playerLastName}`.trim(),
    event: { name: event.name, eventDate, venue: event.venue, firstWhistle: event.firstWhistle },
    ticketUrl,
    qrCid: 'ticket-qr',
    policyUrl: registration.policyReference,
  });
  const token = registration.qrToken;
  if (!token) throw new Error('Cannot email a ticket without a paid QR token');

  const message = {
    subject: email.subject,
    text: email.text,
    html: email.html,
    inlineImages: [{
      cid: 'ticket-qr',
      filename: 'check-in.png',
      contentType: 'image/png',
      content: await qrPng(token),
    }],
    attachments: [{
      filename: `${registration.id}.ics`,
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
      content: Buffer.from(calendar, 'utf8'),
    }],
  };
  if (deps.prisma) {
    await sendEmailToRecipient(
      { prisma: deps.prisma, mailer: deps.mailer },
      {
        eventId: event.id,
        registrationId: registration.id,
        to: registration.parentEmail,
        kind: 'confirmation',
        batchId: options.batchId ?? `confirmation:${registration.id}`,
      },
      message,
      new Date(),
    );
    return;
  }
  await deps.mailer.send({ to: registration.parentEmail, ...message });
}
