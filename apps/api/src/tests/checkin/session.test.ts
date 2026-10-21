import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture } from '../helpers/fixtures';
import { hashPin } from '../../checkin/pin';
import { setCheckInPin } from '../../checkin/service';

let app: ReturnType<typeof createApp>;
let eventId: string;

const BEFORE = '2026-09-12T00:00:00.000Z';
const nowHeader = { 'x-test-now': BEFORE };

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), checkInPinHash: await hashPin('482193') } });
  eventId = event.id;
  app = createApp();
});

describe('check-in session', () => {
  it('opens a session with the right pin and reports counts', async () => {
    const opened = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '482193' }, headers: nowHeader });
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
    const res = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '482193' }, headers: { 'x-test-now': future } });
    expect(res.statusCode).toBe(404);
  });
  it('shares wrong-PIN throttling across app instances', async () => {
    const secondApp = createApp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await (attempt % 2 === 0 ? app : secondApp).inject({
        method: 'POST',
        url: '/api/check-in/session',
        payload: { eventId, pin: '0000' },
        headers: nowHeader,
      });
    }
    const locked = await secondApp.inject({
      method: 'POST',
      url: '/api/check-in/session',
      payload: { eventId, pin: '482193' },
      headers: nowHeader,
    });
    expect(locked.statusCode).toBe(429);
    await secondApp.close();
  });

  it('locks out repeated wrong pins', async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '0000' }, headers: nowHeader });
    }
    const res = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '482193' }, headers: nowHeader });
    expect(res.statusCode).toBe(429);
  });

  const attempt = (pin: string, remoteAddress: string) => app.inject({
    method: 'POST', url: '/api/check-in/session', payload: { eventId, pin }, headers: nowHeader, remoteAddress,
  });

  it('locks the event after 30 wrong pins from many different clients', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await attempt('000000', `198.51.100.${i + 1}`);
      expect(res.statusCode).toBe(401);
    }
    const locked = await attempt('482193', '203.0.113.7');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('pin_locked');
  });

  it('does not count correct pins against the event-wide failure cap', async () => {
    for (let i = 0; i < 29; i++) await attempt('000000', `198.51.100.${i + 1}`);
    for (let i = 0; i < 3; i++) expect((await attempt('482193', `203.0.113.${i + 1}`)).statusCode).toBe(200);
  });

  it('holds the event-wide cap when wrong pins arrive concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => attempt('000000', `198.51.100.${i + 1}`)));
    expect(results.filter((res) => res.statusCode === 401)).toHaveLength(30);
    expect(results.filter((res) => res.statusCode === 429)).toHaveLength(30);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect((await prisma.requestRateLimitBucket.findUniqueOrThrow({
      where: { key: `checkin-fail:${eventId}:${event.checkInPinVersion}` },
    })).hits).toBe(30);
  });

  it('clears an event-wide lockout when the pin is rotated', async () => {
    for (let i = 0; i < 30; i++) await attempt('000000', `198.51.100.${i + 1}`);
    expect((await attempt('482193', '203.0.113.7')).statusCode).toBe(429);
    const previous = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    await setCheckInPin(prisma, eventId, '739104', new Date(BEFORE));
    expect((await attempt('739104', '203.0.113.8')).statusCode).toBe(200);
    const current = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(current.checkInPinVersion).toBe(previous.checkInPinVersion + 1);
    expect((await prisma.requestRateLimitBucket.findUniqueOrThrow({
      where: { key: `checkin-fail:${eventId}:${previous.checkInPinVersion}` },
    })).hits).toBe(30);
    expect((await prisma.requestRateLimitBucket.findUniqueOrThrow({
      where: { key: `checkin-fail:${eventId}:${current.checkInPinVersion}` },
    })).hits).toBe(0);
  });

  it('shares a client bucket across IPv6 addresses in the same /64', async () => {
    for (let i = 0; i < 10; i++) await attempt('000000', `2001:db8:1:2::${(i + 1).toString(16)}`);
    expect((await attempt('482193', '2001:db8:1:2:ffff:ffff:ffff:ffff')).statusCode).toBe(429);
    expect((await attempt('482193', '2001:db8:1:3::1')).statusCode).toBe(200);
  });

  it('treats IPv4-mapped IPv6 addresses as IPv4', async () => {
    for (let i = 0; i < 10; i++) await attempt('000000', '::ffff:198.51.100.9');
    expect((await attempt('482193', '198.51.100.9')).statusCode).toBe(429);
    expect((await attempt('482193', '::ffff:198.51.100.10')).statusCode).toBe(200);
  });

  it('rejects malformed pins after consuming the client limit', async () => {
    for (const pin of ['abcd', '123456789', '12', '']) {
      const res = await attempt(pin, '198.51.100.50');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('pin_invalid');
    }
    for (let i = 0; i < 6; i++) await attempt('x'.repeat(5000), '198.51.100.50');
    expect((await attempt('482193', '198.51.100.50')).statusCode).toBe(429);
  });

  it('still accepts an existing 4-digit pin', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { checkInPinHash: await hashPin('4821') } });
    expect((await attempt('4821', '198.51.100.60')).statusCode).toBe(200);
  });
});
