import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture } from '../helpers/fixtures';

const app = createApp();
let cookie: string;
let eventId: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
  eventId = (await prisma.event.create({ data: eventFixture() })).id;
});

describe('admin check-in pin', () => {
  it('sets and clears a pin, storing only a hash', async () => {
    const set = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: '4821' }, cookies: { nt_session: cookie } });
    expect(set.statusCode).toBe(204);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    expect(event?.checkInPinHash).toContain('scrypt$');
    expect(event?.checkInPinHash).not.toContain('4821');
    const clear = await app.inject({ method: 'DELETE', url: `/api/admin/events/${eventId}/check-in-pin`, cookies: { nt_session: cookie } });
    expect(clear.statusCode).toBe(204);
    expect((await prisma.event.findUnique({ where: { id: eventId } }))?.checkInPinHash).toBeNull();
  });
  it('rejects a badly formatted pin', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/admin/events/${eventId}/check-in-pin`, payload: { pin: 'abcd' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
  });
  it('closes check-in', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/check-in/close`, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(204);
    expect((await prisma.event.findUnique({ where: { id: eventId } }))?.checkInClosedAt).not.toBeNull();
  });
});
