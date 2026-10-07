import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';
import { hashPin } from '../../checkin/pin';

let app: ReturnType<typeof createApp>;
let eventId: string;

const BEFORE = '2026-09-12T00:00:00.000Z';
const nowHeader = { 'x-test-now': BEFORE };

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), checkInPinHash: hashPin('4821') } });
  eventId = event.id;
  app = createApp();
});

describe('check-in session', () => {
  it('opens a session with the right pin and reports counts', async () => {
    const opened = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '4821' }, headers: nowHeader });
    expect(opened.statusCode).toBe(200);
    const cookie = opened.cookies.find((c) => c.name === 'nt_checkin')!;
    const summary = await app.inject({ method: 'GET', url: '/api/check-in/session', cookies: { nt_checkin: cookie.value }, headers: nowHeader });
    expect(summary.json().eventName).toBe('15/U Ladies');
    expect(summary.json().registered).toBe(0);
  });
  it('rejects a wrong pin', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '0000' }, headers: nowHeader });
    expect(res.statusCode).toBe(401);
  });
  it('refuses a pin after the day following the event', async () => {
    const future = new Date('2026-09-14T00:00:00Z').toISOString();
    const res = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '4821' }, headers: { 'x-test-now': future } });
    expect(res.statusCode).toBe(404);
  });
  it('locks out repeated wrong pins', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '0000' }, headers: nowHeader });
    }
    const res = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '4821' }, headers: nowHeader });
    expect(res.statusCode).toBe(429);
  });
});
