import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { createDevMailer } from '../../mail/dev-mailer';
import { requestLoginLink, consumeLoginToken, normalizeEmail } from '../../auth/service';

const deps = () => ({ prisma, mailer, webOrigin: 'http://localhost:5173' });
let mailer: ReturnType<typeof createDevMailer>;

beforeEach(async () => {
  await resetDb();
  mailer = createDevMailer([]);
  await prisma.staffUser.create({ data: { email: 'craig@example.com' } });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Craig.Moyle@Example.COM ')).toBe('craig.moyle@example.com');
  });
});

describe('requestLoginLink', () => {
  it('emails a link for a known admin, matching normalized email', async () => {
    await requestLoginLink(deps(), ' Craig@Example.com ', new Date('2026-10-07T00:00:00Z'));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('craig@example.com');
    expect(mailer.sent[0].text).toContain('http://localhost:5173/admin/verify?token=');
  });
  it('resolves identically and sends nothing for an unknown email', async () => {
    await expect(requestLoginLink(deps(), 'nobody@example.com', new Date())).resolves.toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(0);
  });
  it('invalidates an earlier unused link when a new one is requested', async () => {
    const now = new Date('2026-10-07T00:00:00Z');
    await requestLoginLink(deps(), 'craig@example.com', now);
    const first = extractToken(mailer.sent[0].text);
    await requestLoginLink(deps(), 'craig@example.com', now);
    const second = extractToken(mailer.sent[1].text);
    expect(await consumeLoginToken({ prisma }, first, now)).toBeNull();
    expect(await consumeLoginToken({ prisma }, second, now)).not.toBeNull();
  });
});

describe('consumeLoginToken', () => {
  it('rejects an expired token', async () => {
    const now = new Date('2026-10-07T00:00:00Z');
    await requestLoginLink(deps(), 'craig@example.com', now);
    const token = extractToken(mailer.sent[0].text);
    expect(await consumeLoginToken({ prisma }, token, new Date(now.getTime() + 16 * 60_000))).toBeNull();
  });
  it('rejects an already used token', async () => {
    const now = new Date('2026-10-07T00:00:00Z');
    await requestLoginLink(deps(), 'craig@example.com', now);
    const token = extractToken(mailer.sent[0].text);
    expect(await consumeLoginToken({ prisma }, token, now)).not.toBeNull();
    expect(await consumeLoginToken({ prisma }, token, now)).toBeNull();
  });
});

function extractToken(text: string): string {
  return new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
}
