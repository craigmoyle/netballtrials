import { createHash, randomBytes } from 'node:crypto';

export const LOGIN_TOKEN_TTL_MINUTES = 15;
export const SESSION_TTL_DAYS = 30;

export type TokenRecord = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function record(now: Date, ttlMs: number): TokenRecord {
  const token = generateToken();
  return { token, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + ttlMs) };
}

export function newLoginToken(now: Date): TokenRecord {
  return record(now, LOGIN_TOKEN_TTL_MINUTES * 60_000);
}

export function newSession(now: Date): TokenRecord {
  return record(now, SESSION_TTL_DAYS * 24 * 60 * 60_000);
}
