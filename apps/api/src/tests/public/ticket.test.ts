import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { eventFixture, registrationFixture } from '../helpers/fixtures';

const app = createApp();

beforeEach(resetDb);

describe('public ticket', () => {
  it('returns the player name, event, and bib for a paid registration', async () => {
    const { token } = await seedPaid();
    const res = await app.inject({ method: 'GET', url: `/api/public/ticket/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().playerName).toBe('Ada Lovelace');
    expect(res.json().bibNumber).toBe(42);
    expect(res.json().qrCode).toMatch(/^data:image\/png;base64,/);
    expect(res.json().event.startTime).toBe('08:30');
    expect(res.json()).not.toHaveProperty('parentEmail');
    expect(res.json()).not.toHaveProperty('parentName');
    expect(res.json()).not.toHaveProperty('amountCents');
    expect(res.json()).not.toHaveProperty('status');
  });
  it('serves the matching Melbourne-time calendar file for a paid ticket', async () => {
    const { token } = await seedPaid();
    const res = await app.inject({ method: 'GET', url: `/api/public/ticket/${token}/calendar` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toContain('.ics');
    expect(res.body).toContain('DTSTART:20260911T223000Z');
    expect(res.body).toContain('DTEND:20260912T020000Z');
  });
  it('returns 404 for an unpaid registration token', async () => {
    const event = await prisma.event.create({ data: eventFixture() });
    const reg = await prisma.registration.create({ data: { ...registrationFixture(event.id), status: 'PENDING', qrToken: null } });
    const res = await app.inject({ method: 'GET', url: `/api/public/ticket/${reg.id}` });
    expect(res.statusCode).toBe(404);
  });
});

async function seedPaid() {
  const event = await prisma.event.create({ data: eventFixture() });
  const token = 'a'.repeat(43);
  await prisma.registration.create({ data: { ...registrationFixture(event.id), status: 'PAID', bibNumber: 42, qrToken: token } });
  return { token };
}
