import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
  const event = await prisma.event.create({ data: eventFixture() });
  eventId = event.id;
  await prisma.registration.create({ data: registrationFixture(eventId, { status: 'PAID' }) });
});

describe('admin message delivery routes', () => {
  it('previews the exact distinct paid recipient count', async () => {
    await prisma.registration.create({ data: registrationFixture(eventId, { playerFirstName: 'Sibling', playerNameNormalized: 'sibling', parentEmail: 'ANNE@example.com', status: 'PAID' }) });
    await prisma.registration.create({ data: registrationFixture(eventId, { playerFirstName: 'Different', playerNameNormalized: 'different', parentEmail: 'BO@example.com', status: 'PAID' }) });
    await prisma.registration.create({ data: registrationFixture(eventId, { playerFirstName: 'Pending', playerNameNormalized: 'pending', parentEmail: 'pending@example.com', status: 'PENDING' }) });
    await prisma.registration.create({ data: registrationFixture(eventId, { playerFirstName: 'Withdrawn', playerNameNormalized: 'withdrawn', parentEmail: 'gone@example.com', status: 'WITHDRAWN' }) });
    const denied = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/message-recipients` });
    const preview = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/message-recipients`, cookies: { nt_session: cookie } });
    expect(denied.statusCode).toBe(401);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({ count: 2 });
  });

  it('requires an admin and an idempotency batch ID', async () => {
    const unauthenticated = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/messages`, payload: { subject: 'Test', text: 'Body', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    const noBatch = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/messages`, cookies: { nt_session: cookie }, payload: { subject: 'Test', text: 'Body' },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(noBatch.statusCode).toBe(400);
  });

  it('records the acting administrator in the delivery batch', async () => {
    const result = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${eventId}/messages`,
      cookies: { nt_session: cookie },
      payload: { subject: 'Test', text: 'Body', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff', sent: 1, failed: 0 });
    const row = await prisma.emailLog.findFirstOrThrow({ where: { batchId: result.json().batchId } });
    expect(row.senderUserId).toBe((await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@example.com' } })).id);
    expect(row.status).toBe('SENT');
  });

  it('returns the durable per-recipient delivery state from the email log', async () => {
    const result = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/messages`, cookies: { nt_session: cookie },
      payload: { subject: 'Test', text: 'Body', batchId: '4b4454b6-b787-44b5-b6db-c2ff5f087eff' },
    });
    const log = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/email-log`, cookies: { nt_session: cookie } });
    expect(log.json()[0]).toMatchObject({
      batchId: result.json().batchId,
      senderUserId: (await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@example.com' } })).id,
      status: 'SENT',
      body: 'Body',
      attempts: 1,
    });
  });
});
