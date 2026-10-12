import { describe, it, expect } from 'vitest';
import { qrDataUrl } from '../../registrations/qr';
import { buildIcs } from '../../registrations/ics';
import { buildTrialCalendar } from '../../registrations/calendar';
import { buildConfirmation, sendConfirmation } from '../../registrations/confirmation';
import { createDevMailer } from '../../mail/dev-mailer';
import { GmailDeliveryError } from '../../mail/gmail-mailer';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { retryFailedDeliveries } from '../../messages/service';

describe('qrDataUrl', () => {
  it('produces a png data url for a token', async () => {
    const url = await qrDataUrl('opaque-token');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('buildIcs', () => {
  it('produces a calendar entry with a stable UID and CRLF line endings', () => {
    const ics = buildIcs({
      uid: 'reg-123@chisholmnetball.com', title: '15/U Trials',
      start: new Date('2026-09-11T22:30:00Z'), end: new Date('2026-09-12T02:00:00Z'),
      location: 'SNC', description: 'Arrive by 08:30',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:reg-123@chisholmnetball.com');
    expect(ics).toContain('DTSTART:20260911T223000Z');
    expect(ics).toContain('DTEND:20260912T020000Z');
    expect(ics).toContain('LOCATION:SNC');
    expect(ics.split('\r\n').length).toBeGreaterThan(5);
  });

  it('escapes text fields and folds each content line at the RFC octet limit', () => {
    const ics = buildIcs({
      uid: 'r@chisholmnetball.com',
      title: `Trials, finals;\n${'é'.repeat(60)}`,
      start: new Date('2026-09-11T22:30:00Z'),
      end: new Date('2026-09-12T02:00:00Z'),
      location: 'Court; A, SNC',
      description: 'Line one\nLine two',
    });
    expect(ics).toContain('SUMMARY:Trials\\, finals\\;\\n');
    expect(ics).toContain('LOCATION:Court\\; A\\, SNC');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics.split('\r\n').filter(Boolean).every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});

describe('trial calendar', () => {
  it('calls the assigned identifier Number, not bib', () => {
    const calendar = buildTrialCalendar(
      { name: '15/U Trials', eventDate: new Date('2026-09-12T00:00:00Z'), startTime: '08:30', endTime: '12:00', venue: 'SNC' },
      'trial-calendar@chisholmnetball.com',
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(calendar.replace(/\r\n /g, '')).toContain('DESCRIPTION:Bring your QR code to check in. Your player Number will be issued at the door.');
    expect(calendar).not.toMatch(/bib/i);
  });
});

describe('durable confirmation delivery', () => {
  it('logs failed confirmation and retries with the same inline QR and ICS attachment', async () => {
    await resetDb();
    const event = await prisma.event.create({ data: eventFixture() });
    const registration = await prisma.registration.create({
      data: { ...registrationFixture(event.id), status: 'PAID', qrToken: 'opaque-confirmation-token'.repeat(2) },
    });
    const sent: Parameters<NonNullable<ReturnType<typeof createDevMailer>['send']>>[0][] = [];
    let attempt = 0;
    const mailer = { send: async (message: any) => {
      attempt += 1;
      if (attempt === 1) throw new GmailDeliveryError('Gmail temporarily unavailable', 503);
      sent.push(message);
    } };
    await sendConfirmation(
      { prisma, mailer }, registration,
      { id: event.id, name: event.name, eventDate: event.eventDate, venue: event.venue, startTime: event.startTime, endTime: event.endTime, firstWhistle: event.firstWhistle },
      'https://trials.example/ticket/opaque-token',
    );
    const delivery = await prisma.emailLog.findFirstOrThrow({ where: { registrationId: registration.id, kind: 'confirmation' } });
    expect(delivery.status).toBe('AMBIGUOUS');
    const retry = await retryFailedDeliveries({ prisma, mailer }, event.id, delivery.batchId, [delivery.id], new Date(), { includeAmbiguous: true });
    expect(retry.sent).toBe(1);
    expect(sent).toHaveLength(1);
    const inlineQr = sent[0].inlineImages![0];
    const calendarAttachment = sent[0].attachments![0];
    expect(inlineQr.cid).toBe('ticket-qr');
    expect(calendarAttachment.filename).toBe(`${registration.id}.ics`);
    const delivered = await prisma.emailLog.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(delivered.status).toBe('SENT');
    expect((delivered.messagePayload as any).inlineImages[0].contentBase64).toBe(Buffer.from(inlineQr.content).toString('base64'));
    expect((delivered.messagePayload as any).attachments[0].filename).toBe(`${registration.id}.ics`);
  });
});

describe('buildConfirmation', () => {
  it('uses an inline QR cid and escapes URL attributes', () => {
    const email = buildConfirmation({
      playerName: 'Ada Lovelace',
      event: { name: '15/U Trials', eventDate: '2026-09-12', venue: 'SNC', firstWhistle: '09:00' },
      ticketUrl: 'https://example.com/ticket/abc',
      qrCid: 'ticket-qr',
      policyUrl: 'https://example.com/policy?x=1&y=2',
    });
    expect(email.subject).toContain('15/U Trials');
    expect(email.text).toContain('https://example.com/ticket/abc');
    expect(email.html).toContain('src="cid:ticket-qr"');
    expect(email.html).toContain('https://example.com/policy?x=1&amp;y=2');
  });

  it('sends a real inline QR and attached Melbourne calendar through EmailProvider', async () => {
    const mailer = createDevMailer([]);
    await sendConfirmation(
      { mailer },
      {
        id: 'registration-1', playerFirstName: 'Ada', playerLastName: 'Lovelace',
        parentEmail: 'anne@example.com', policyReference: 'https://example.com/policy',
        qrToken: 'opaque-random-ticket-token',
      },
      {
        id: 'event-1', name: '15/U Trials', eventDate: new Date('2026-09-12T00:00:00Z'), venue: 'SNC',
        startTime: '08:30', endTime: '12:00', firstWhistle: '09:00',
      },
      'https://trials.example/ticket/opaque-random-ticket-token',
    );
    const message = mailer.sent[0];
    expect(message.to).toBe('anne@example.com');
    expect(message.text).toContain('https://trials.example/ticket/opaque-random-ticket-token');
    expect(message.html).toContain('src="cid:ticket-qr"');
    expect(message.inlineImages?.[0].cid).toBe('ticket-qr');
    expect(message.inlineImages?.[0].content.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(message.attachments?.[0].filename).toBe('registration-1.ics');
    const calendar = Buffer.from(message.attachments?.[0].content ?? []).toString('utf8');
    expect(calendar).toContain('DTSTART:20260911T223000Z');
    expect(calendar).toContain('DTEND:20260912T020000Z');
  });
});
