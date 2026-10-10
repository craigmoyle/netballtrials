import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { seedEventWithPlayers } from '../helpers/planner';

const app = createApp();

beforeEach(resetDb);

describe('planner routes', () => {
  it('requires an admin session', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/events/x/plan/generate' })).statusCode,
    ).toBe(401);
  });
  it('generates, reads, and publishes a plan', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const generated = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${event.id}/plan/generate`,
      cookies: { nt_session: cookie },
    });
    expect(generated.statusCode).toBe(201);
    const read = await app.inject({
      method: 'GET',
      url: `/api/admin/events/${event.id}/plan`,
      cookies: { nt_session: cookie },
    });
    expect(read.json().slots).toHaveLength(2 * 2 * 14);
    const published = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${event.id}/plan/publish`,
      cookies: { nt_session: cookie },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe('PUBLISHED');
  });
  it('explains an infeasible request', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(20, { courts: 2, checkedIn: 20 });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/events/${event.id}/plan/generate`,
      cookies: { nt_session: cookie },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('infeasible');
    expect(res.json().gaps.length).toBeGreaterThan(0);
  });
});
