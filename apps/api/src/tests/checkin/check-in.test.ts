import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { hashPin } from '../../checkin/pin';

let app: ReturnType<typeof createApp>;
let cookie: string;
let eventId: string;

const header = { 'x-test-now': '2026-09-12T00:00:00.000Z' };

beforeEach(async () => {
  await resetDb();
  const event = await prisma.event.create({ data: { ...eventFixture(), checkInPinHash: hashPin('4821') } });
  eventId = event.id;
  app = createApp();
  const opened = await app.inject({ method: 'POST', url: '/api/check-in/session', payload: { eventId, pin: '4821' }, headers: header });
  cookie = opened.cookies.find((c) => c.name === 'nt_checkin')!.value;
});

async function paid(token: string, overrides: Record<string, unknown> = {}) {
  return prisma.registration.create({ data: { ...registrationFixture(eventId), status: 'PAID', qrToken: token, ...overrides } });
}

describe('check-in', () => {
  it('checks a paid player in and assigns the next bib', async () => {
    await paid('t'.repeat(43));
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json().result).toBe('checked_in');
    expect(res.json().bibNumber).toBe(1);
  });
  it('is idempotent for a second scan', async () => {
    await paid('t'.repeat(43));
    await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    const again = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(again.json().result).toBe('already');
    expect(again.json().bibNumber).toBe(1);
  });
  it('refuses an unpaid registration', async () => {
    await prisma.registration.create({ data: { ...registrationFixture(eventId), status: 'PENDING', qrToken: 'p'.repeat(43) } });
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'p'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json()).toMatchObject({ result: 'refused', reason: 'not_paid' });
  });
  it('refuses an unknown token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 'z'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json()).toMatchObject({ result: 'refused', reason: 'unknown' });
  });
  it('marks a review-flagged registration without leaking detail', async () => {
    await paid('t'.repeat(43), { ageFlagged: true });
    const res = await app.inject({ method: 'POST', url: '/api/check-in/scan', payload: { token: 't'.repeat(43) }, cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json().referToCommittee).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain('age');
  });
  it('finds a paid registration by partial, differently cased name', async () => {
    await paid('t'.repeat(43));
    const res = await app.inject({ method: 'GET', url: '/api/check-in/lookup?q=LOVE', cookies: { nt_checkin: cookie }, headers: header });
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].playerName).toBe('Ada Lovelace');
  });
  it('undoes a check-in', async () => {
    const reg = await paid('t'.repeat(43));
    await app.inject({ method: 'POST', url: `/api/check-in/registrations/${reg.id}`, cookies: { nt_checkin: cookie }, headers: header });
    const undo = await app.inject({ method: 'POST', url: `/api/check-in/registrations/${reg.id}/undo`, cookies: { nt_checkin: cookie }, headers: header });
    expect(undo.statusCode).toBe(204);
    expect((await prisma.registration.findUnique({ where: { id: reg.id } }))?.checkedInAt).toBeNull();
  });
  it('requires a check-in session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/check-in/lookup?q=a' });
    expect(res.statusCode).toBe(401);
  });
});
