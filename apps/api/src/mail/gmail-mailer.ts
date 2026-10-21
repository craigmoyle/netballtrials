import nodemailer from 'nodemailer';
import type { EmailMessage, EmailProvider } from './provider';

const SENDER = 'chisholmnetball@gmail.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailDeliveryError extends Error {
  readonly status: number | undefined;
  /** True when the failure happened before the Gmail send request was made. */
  readonly notSent: boolean;

  constructor(message: string, status?: number, options: { notSent?: boolean } = {}) {
    super(message);
    this.name = 'GmailDeliveryError';
    this.status = status;
    this.notSent = options.notSent ?? false;
  }
}

const NOT_SENT = { notSent: true } as const;

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type TokenResponse = { access_token?: unknown; expires_in?: unknown };

export function createGmailMailer(
  config: GmailConfig,
  fetcher: typeof fetch = fetch,
): EmailProvider & { provider: 'gmail-api' } {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  let accessToken: string | null = null;
  let expiresAt = 0;
  let refreshInFlight: Promise<string> | null = null;

  async function getAccessToken(): Promise<string> {
    if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      });
      let response: Response;
      try {
        response = await fetcher(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new GmailDeliveryError('Gmail OAuth token refresh failed', undefined, NOT_SENT);
      }
      if (!response.ok) throw new GmailDeliveryError('Gmail OAuth token refresh failed', response.status, NOT_SENT);

      let result: TokenResponse;
      try {
        result = await response.json() as TokenResponse;
      } catch {
        throw new GmailDeliveryError('Gmail OAuth token response was invalid', response.status, NOT_SENT);
      }
      if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number') {
        throw new GmailDeliveryError('Gmail OAuth token response was invalid', response.status, NOT_SENT);
      }
      accessToken = result.access_token;
      expiresAt = Date.now() + result.expires_in * 1000;
      return accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  return {
    provider: 'gmail-api',
    async send(message: EmailMessage): Promise<void> {
      let raw: Buffer;
      try {
        const composed = await composer.sendMail({
          from: SENDER,
          replyTo: SENDER,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: [
            ...(message.inlineImages ?? []).map((image) => ({
              filename: image.filename,
              contentType: image.contentType,
              content: Buffer.from(image.content),
              cid: image.cid,
              contentDisposition: 'inline' as const,
            })),
            ...(message.attachments ?? []).map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              content: Buffer.from(attachment.content),
              contentDisposition: 'attachment' as const,
            })),
          ],
        });
        if (Buffer.isBuffer(composed.message)) {
          raw = composed.message;
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of composed.message) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          raw = Buffer.concat(chunks);
        }
      } catch {
        throw new GmailDeliveryError('Email could not be composed', undefined, NOT_SENT);
      }

      let token = await getAccessToken();
      let response: Response;
      for (let attempt = 0; ; attempt += 1) {
        try {
          response = await fetcher(GMAIL_SEND_URL, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ raw: raw.toString('base64url') }),
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          throw new GmailDeliveryError('Gmail send request failed');
        }
        if (response.status !== 401 || attempt > 0) break;
        if (accessToken === token) {
          accessToken = null;
          expiresAt = 0;
        }
        token = await getAccessToken();
      }
      if (!response.ok) throw new GmailDeliveryError('Gmail rejected the message', response.status);
    },
  };
}
