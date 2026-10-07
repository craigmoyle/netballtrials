import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';

const app = createApp();
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'admin@example.com');
});

const payload = { name: '17/U', competitionYear: 2027, division: '17/U', section: 'Ladies', eventDate: '2026-09-12', venue: 'SNC', startTime: '08:30', endTime: '12:00', firstWhistle: '09:00', lastWhistle: '11:30', registrationFeeCents: 3500, courts: 4, rank1Min: 2, rank2Min: 1, rank3Min: 1, minAge: 14, maxAge: 17 };

describe('event admin routes', () => {
  it('requires an admin session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/events' });
    expect(res.statusCode).toBe(401);
  });
  it('creates and lists an event for an admin', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/events', payload, cookies: { nt_session: cookie } });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: 'GET', url: '/api/admin/events', cookies: { nt_session: cookie } });
    expect(listed.json()).toHaveLength(1);
  });
  it('returns 400 with field errors for a reversed window', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/events', payload: { ...payload, lastWhistle: '08:45' }, cookies: { nt_session: cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
    expect(res.json().fields).toContain('lastWhistle');
  });
});
