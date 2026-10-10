import { describe, expect, it, vi } from 'vitest';
import { createGmailMailer, GmailDeliveryError } from '../../mail/gmail-mailer';

const config = {
  clientId: 'client-secret-id',
  clientSecret: 'client-secret-value',
  refreshToken: 'refresh-token-secret',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Gmail OAuth mail provider', () => {
  it('refreshes OAuth and sends text, HTML, inline QR, and ICS through Gmail API', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      return url.includes('/token')
        ? response({ access_token: 'access-token-secret', expires_in: 3600, token_type: 'Bearer' })
        : response({ id: 'gmail-message-id' });
    });
    const mailer = createGmailMailer(config, fetcher as typeof fetch);

    await mailer.send({
      to: 'parent@example.com',
      subject: 'Trial details',
      text: 'Plain confirmation',
      html: '<p>HTML confirmation <img src="cid:ticket-qr"></p>',
      inlineImages: [{ cid: 'ticket-qr', filename: 'ticket.png', contentType: 'image/png', content: Buffer.from('png-data') }],
      attachments: [{ filename: 'trial.ics', contentType: 'text/calendar; charset=utf-8', content: Buffer.from('BEGIN:VCALENDAR') }],
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    ]);
    const oauth = requests[0].init!;
    expect(oauth.method).toBe('POST');
    expect(String(oauth.body)).toContain('grant_type=refresh_token');
    expect(String(oauth.body)).toContain(encodeURIComponent(config.refreshToken));
    const send = requests[1].init!;
    expect((send.headers as Record<string, string>).authorization).toBe('Bearer access-token-secret');
    const raw = (JSON.parse(String(send.body)) as { raw: string }).raw;
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('From: chisholmnetball@gmail.com');
    expect(mime).toContain('Reply-To: chisholmnetball@gmail.com');
    expect(mime).toContain('To: parent@example.com');
    expect(mime).toContain('Plain confirmation');
    expect(mime).toContain('HTML confirmation');
    expect(mime).toContain('Content-ID: <ticket-qr>');
    expect(mime).toContain('trial.ics');
    expect(mime).toContain('Content-Type: text/calendar');
    expect(mime).toContain(Buffer.from('BEGIN:VCALENDAR').toString('base64'));
  });

  it('refreshes an access token once after Gmail rejects it with 401', async () => {
    const authorizations: string[] = [];
    let tokenNumber = 0;
    let sendNumber = 0;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).includes('/token')) {
        tokenNumber += 1;
        return response({ access_token: `access-${tokenNumber}`, expires_in: 3600 });
      }
      authorizations.push((init?.headers as Record<string, string>).authorization);
      sendNumber += 1;
      return sendNumber === 1 ? response({ error: 'expired' }, 401) : response({ id: 'ok' });
    });
    const mailer = createGmailMailer(config, fetcher as typeof fetch);
    await mailer.send({ to: 'parent@example.com', subject: 'Retry token', text: 'Body' });
    expect(authorizations).toEqual(['Bearer access-1', 'Bearer access-2']);
    expect(tokenNumber).toBe(2);
    expect(sendNumber).toBe(2);
  });

  it('reuses a refreshed access token until shortly before expiry', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      calls += 1;
      return String(input).includes('/token')
        ? response({ access_token: 'cached-token', expires_in: 3600 })
        : response({ id: `message-${calls}` });
    });
    const mailer = createGmailMailer(config, fetcher as typeof fetch);
    await mailer.send({ to: 'a@example.com', subject: 'one', text: 'one' });
    await mailer.send({ to: 'b@example.com', subject: 'two', text: 'two' });
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(1);
  });

  it('does not expose OAuth credentials or message content in delivery errors', async () => {
    const fetcher = vi.fn(async () => response({ error: 'invalid_grant', error_description: 'refresh-token-secret' }, 400));
    const mailer = createGmailMailer(config, fetcher as typeof fetch);
    await expect(mailer.send({ to: 'parent@example.com', subject: 'private subject', text: 'private child details' }))
      .rejects.toBeInstanceOf(GmailDeliveryError);
    try {
      await mailer.send({ to: 'parent@example.com', subject: 'private subject', text: 'private child details' });
    } catch (error) {
      expect((error as Error).message).not.toContain(config.refreshToken);
      expect((error as Error).message).not.toContain('private child details');
    }
  });

  it('reports Gmail provider rejection without leaking the MIME body', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => String(input).includes('/token')
      ? response({ access_token: 'access-token-secret', expires_in: 3600 })
      : response({ error: { message: 'mailbox denied private child details' } }, 403));
    const mailer = createGmailMailer(config, fetcher as typeof fetch);
    await expect(mailer.send({ to: 'parent@example.com', subject: 'private child details', text: 'private child details' }))
      .rejects.toMatchObject({ status: 403 });
    try {
      await mailer.send({ to: 'parent@example.com', subject: 'private child details', text: 'private child details' });
    } catch (error) {
      expect((error as Error).message).not.toContain('private child details');
      expect((error as Error).message).not.toContain('access-token-secret');
    }
  });
});
