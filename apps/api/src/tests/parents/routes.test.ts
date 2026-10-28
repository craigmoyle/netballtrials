import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { createDevMailer } from '../../mail/dev-mailer';
import { createFakePaymentProvider } from '../../payments/fake';
import { hashToken } from '../../auth/tokens';
import { signInAsNewAdmin } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

let app: ReturnType<typeof createApp>;
let eventId: string;
let mailer: ReturnType<typeof createDevMailer>;

const env = {
  DATABASE_URL: '', NODE_ENV: 'test' as const, PAYMENT_PROVIDER: 'fake' as const,
  WEB_ORIGIN: 'http://localhost:5173', API_PUBLIC_URL: 'http://localhost:3000', TRUST_PROXY: '',
  SESSION_COOKIE_SECURE: false, MAIL_FROM: 'chisholmnetball@gmail.com', MAIL_REPLY_TO: 'chisholmnetball@gmail.com',
  GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '',
  STRIPE_SECRET_KEY: 'x', STRIPE_WEBHOOK_SECRET: 'y', PORT: 3000,
};

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), status: 'OPEN' } });
  eventId = event.id;
  await prisma.memberAssociation.create({ data: { name: 'MENA', active: true } });
  mailer = createDevMailer([]);
  app = createApp({ payment: createFakePaymentProvider(), mailer, env });
});

afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
});

async function addRegistration(
  firstName: string,
  lastName: string,
  email: string,
  overrides: Record<string, unknown> = {},
) {
  return prisma.registration.create({
    data: {
      ...registrationFixture(eventId),
      playerFirstName: firstName,
      playerLastName: lastName,
      playerNameNormalized: `${firstName} ${lastName}`.trim().toLowerCase(),
      parentEmail: email,
      parentAuthorityConfirmedAt: new Date(),
      parentEmailVerifiedAt: new Date(),
      ...overrides,
    },
  });
}

function rawToken(text: string): string {
  const link = text.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) throw new Error('Email did not contain a link');
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
  if (!token) throw new Error('Email link did not contain a token');
  return token;
}

async function parentSession(email: string): Promise<string> {
  const requested = await app.inject({ method: 'POST', url: '/api/public/parent-access/request-link', payload: { email } });
  expect(requested.statusCode).toBe(202);
  const signIn = [...mailer.sent].reverse().find((message) => message.subject.includes('Sign in to manage'));
  expect(signIn).toBeDefined();
  const token = rawToken(signIn!.text);
  const response = await app.inject({ method: 'POST', url: '/api/public/parent-access/verify', payload: { token } });
  expect(response.statusCode).toBe(200);
  return response.cookies.find((cookie) => cookie.name === 'nt_parent')!.value;
}

describe('parent registration access', () => {
  it('uses a neutral, single-use sign-in link and scopes access to all matching registrations', async () => {
    const ada = await addRegistration('Ada', 'Lovelace', 'parent@example.test');
    const grace = await addRegistration('Grace', 'Hopper', 'PARENT@example.test');
    await addRegistration('Katherine', 'Johnson', 'other@example.test');

    const unknown = await app.inject({ method: 'POST', url: '/api/public/parent-access/request-link', payload: { email: 'unknown@example.test' } });
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toEqual({ status: 'sent' });
    expect(mailer.sent).toHaveLength(0);

    const known = await app.inject({ method: 'POST', url: '/api/public/parent-access/request-link', payload: { email: 'parent@example.test' } });
    expect(known.statusCode).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    const signIn = mailer.sent[0];
    expect(signIn.subject).toContain('Sign in to manage');
    expect(signIn.text).not.toContain('Ada Lovelace');
    expect(signIn.text).not.toContain('Grace Hopper');

    const token = rawToken(signIn.text);
    expect(await prisma.parentAccessToken.findUnique({ where: { tokenHash: hashToken(token) } })).toMatchObject({ usedAt: null, purpose: 'SIGN_IN' });
    const verified = await app.inject({ method: 'POST', url: '/api/public/parent-access/verify', payload: { token } });
    expect(verified.statusCode).toBe(200);
    const cookie = verified.cookies.find((item) => item.name === 'nt_parent')!.value;
    const listed = await app.inject({ method: 'GET', url: '/api/parent/registrations', cookies: { nt_parent: cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().map((registration: { id: string }) => registration.id).sort()).toEqual([ada.id, grace.id].sort());

    const replay = await app.inject({ method: 'POST', url: '/api/public/parent-access/verify', payload: { token } });
    expect(replay.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/parent/registrations' })).statusCode).toBe(401);
  });

  it('rejects expired links', async () => {
    await addRegistration('Ada', 'Lovelace', 'parent@example.test');
    await app.inject({ method: 'POST', url: '/api/public/parent-access/request-link', payload: { email: 'parent@example.test' } });
    const token = rawToken(mailer.sent[0].text);
    await prisma.parentAccessToken.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1) } });

    const response = await app.inject({ method: 'POST', url: '/api/public/parent-access/verify', payload: { token } });
    expect(response.statusCode).toBe(400);
    expect(response.cookies.some((cookie) => cookie.name === 'nt_parent')).toBe(false);
  });

  it('allows edits only within the verified email group and records changes', async () => {
    const ada = await addRegistration('Ada', 'Lovelace', 'parent@example.test');
    const grace = await addRegistration('Grace', 'Hopper', 'parent@example.test');
    const other = await addRegistration('Katherine', 'Johnson', 'other@example.test');
    const cookie = await parentSession('parent@example.test');
    const cookies = { nt_parent: cookie };

    const updated = await app.inject({ method: 'PATCH', url: `/api/parent/registrations/${ada.id}`, cookies, payload: { playerFirstName: 'Augusta' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ playerName: 'Augusta Lovelace' });
    expect(await prisma.registrationChangeLog.findMany({ where: { registrationId: ada.id } })).toHaveLength(1);

    const siblingCollision = await app.inject({ method: 'PATCH', url: `/api/parent/registrations/${ada.id}`, cookies, payload: { playerFirstName: 'Grace', playerLastName: 'Hopper' } });
    expect(siblingCollision.statusCode).toBe(409);
    const isolated = await app.inject({ method: 'PATCH', url: `/api/parent/registrations/${other.id}`, cookies, payload: { playerFirstName: 'Changed' } });
    expect(isolated.statusCode).toBe(404);

    await prisma.event.update({ where: { id: eventId }, data: { status: 'CLOSED' } });
    const locked = await app.inject({ method: 'PATCH', url: `/api/parent/registrations/${grace.id}`, cookies, payload: { playerFirstName: 'Closed' } });
    expect(locked.statusCode).toBe(409);
  });

  it('withdraws a registration without issuing a refund', async () => {
    const paid = await addRegistration('Ada', 'Lovelace', 'parent@example.test', { status: 'PAID', qrToken: 'ticket-token' });
    const cookie = await parentSession('parent@example.test');
    const response = await app.inject({ method: 'POST', url: `/api/parent/registrations/${paid.id}/withdraw`, cookies: { nt_parent: cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'WITHDRAWN', ticketPath: null });
    expect(await prisma.registrationChangeLog.findMany({ where: { registrationId: paid.id } })).toHaveLength(1);
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: 'WITHDRAWN', qrToken: 'ticket-token' });
  });

  it('changes every registration only after the new address confirms and keeps an audit trail', async () => {
    const ada = await addRegistration('Ada', 'Lovelace', 'parent@example.test');
    const grace = await addRegistration('Grace', 'Hopper', 'parent@example.test', { parentEmailVerifiedAt: null });
    const cookie = await parentSession('parent@example.test');
    const cookies = { nt_parent: cookie };
    const requested = await app.inject({ method: 'POST', url: '/api/parent/email-change', cookies, payload: { email: 'family@example.test' } });
    expect(requested.statusCode).toBe(202);
    const confirmation = mailer.sent.find((message) => message.subject === 'Confirm your new Netball Trials email');
    expect(confirmation?.to).toBe('family@example.test');
    const token = rawToken(confirmation!.text);

    const changed = await app.inject({ method: 'POST', url: '/api/parent/email-change/confirm', cookies, payload: { token } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ status: 'email_updated', email: 'family@example.test' });
    const registrations = await prisma.registration.findMany({ where: { id: { in: [ada.id, grace.id] } } });
    expect(registrations.every((registration) => registration.parentEmail === 'family@example.test' && registration.parentEmailVerifiedAt)).toBe(true);
    const changes = await prisma.registrationChangeLog.findMany({ where: { registrationId: { in: [ada.id, grace.id] } } });
    expect(changes).toHaveLength(2);
    expect(changes.every((change) => Array.isArray(change.changedFields) && change.changedFields.includes('parentEmail'))).toBe(true);
    const listed = await app.inject({ method: 'GET', url: '/api/parent/registrations', cookies });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(2);
    expect(mailer.sent.some((message) => message.to === 'parent@example.test' && message.subject === 'Your Netball Trials email was changed')).toBe(true);
  });

  it('refuses to merge a parent group into an email already linked to another registration', async () => {
    const ada = await addRegistration('Ada', 'Lovelace', 'parent@example.test');
    const existing = await addRegistration('Grace', 'Hopper', 'family@example.test');
    const cookie = await parentSession('parent@example.test');
    const cookies = { nt_parent: cookie };
    await app.inject({ method: 'POST', url: '/api/parent/email-change', cookies, payload: { email: 'family@example.test' } });
    const confirmation = mailer.sent.find((message) => message.subject === 'Confirm your new Netball Trials email');
    const token = rawToken(confirmation!.text);

    const result = await app.inject({ method: 'POST', url: '/api/parent/email-change/confirm', cookies, payload: { token } });
    expect(result.statusCode).toBe(409);
    expect(result.json()).toEqual({ error: 'email_change_unavailable' });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: ada.id } })).toMatchObject({ parentEmail: 'parent@example.test' });
    expect(await prisma.registration.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ parentEmail: 'family@example.test' });
    expect((await app.inject({ method: 'GET', url: '/api/parent/registrations', cookies })).json()).toHaveLength(1);
  });

  it('reports incomplete stages and only sends payment reminders to verified, pending registrations', async () => {
    const pending = await addRegistration('Ada', 'Lovelace', 'verified@example.test');
    const unverified = await addRegistration('Grace', 'Hopper', 'unverified@example.test', { parentEmailVerifiedAt: null });
    const expired = await addRegistration('Katherine', 'Johnson', 'expired@example.test', { status: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) });
    const paid = await addRegistration('Dorothy', 'Vaughan', 'paid@example.test', { status: 'PAID' });
    const adminCookie = await signInAsNewAdmin(app, 'follow-up-admin@example.test');

    const denied = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/incomplete-registrations` });
    expect(denied.statusCode).toBe(401);
    const list = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/incomplete-registrations`, cookies: { nt_session: adminCookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(3);
    expect(list.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pending.id, stage: 'PAYMENT', parentEmailVerified: true }),
      expect.objectContaining({ id: unverified.id, stage: 'EMAIL_CONFIRMATION', parentEmailVerified: false }),
      expect.objectContaining({ id: expired.id, stage: 'PAYMENT_EXPIRED' }),
    ]));
    expect(list.json().some((registration: { id: string }) => registration.id === paid.id)).toBe(false);

    const refused = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/incomplete-registrations/${unverified.id}/reminder`, cookies: { nt_session: adminCookie } });
    expect(refused.statusCode).toBe(409);
    expect(mailer.sent.some((message) => message.to === 'unverified@example.test')).toBe(false);

    const reminder = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/incomplete-registrations/${pending.id}/reminder`, cookies: { nt_session: adminCookie } });
    expect(reminder.statusCode).toBe(200);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: pending.id } })).parentFollowUpSentAt).toBeInstanceOf(Date);
    expect(mailer.sent.some((message) => message.to === 'verified@example.test' && message.subject === 'Continue your Netball Trials registration')).toBe(true);
    const listAfter = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/incomplete-registrations`, cookies: { nt_session: adminCookie } });
    expect(listAfter.json().find((registration: { id: string }) => registration.id === pending.id).followUpSentAt).toBeTruthy();
  });
});
