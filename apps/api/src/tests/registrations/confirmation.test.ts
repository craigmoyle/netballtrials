import { describe, it, expect } from 'vitest';
import { qrDataUrl } from '../../registrations/qr';
import { buildIcs } from '../../registrations/ics';
import { buildConfirmation } from '../../registrations/confirmation';

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
      start: new Date('2026-09-12T09:00:00Z'), end: new Date('2026-09-12T12:00:00Z'),
      location: 'SNC', description: 'Arrive by 08:30',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:reg-123@chisholmnetball.com');
    expect(ics).toContain('LOCATION:SNC');
    expect(ics.split('\r\n').length).toBeGreaterThan(5);
  });
});

describe('buildConfirmation', () => {
  it('includes the ticket link, QR, policy link, and calendar data', () => {
    const email = buildConfirmation({
      playerName: 'Ada Lovelace',
      event: { name: '15/U Trials', eventDate: '2026-09-12', venue: 'SNC', firstWhistle: '09:00' },
      ticketUrl: 'https://example.com/ticket/abc',
      qrDataUrl: 'data:image/png;base64,AAAA',
      policyUrl: 'https://chisholmnetball.com/selection-policy/',
      icsText: 'BEGIN:VCALENDAR',
    });
    expect(email.subject).toContain('15/U Trials');
    expect(email.text).toContain('https://example.com/ticket/abc');
    expect(email.html).toContain('data:image/png;base64,AAAA');
    expect(email.html).toContain('https://chisholmnetball.com/selection-policy/');
  });
});
