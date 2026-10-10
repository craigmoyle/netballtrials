import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { seedEventWithPlayers } from '../helpers/planner';
import { withdrawRegistration } from '../../registrations/service';

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
  it('does not expose a draft through the final selector-sheet route', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const generated = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/generate`, cookies: { nt_session: cookie } });
    expect(generated.statusCode).toBe(201);
    const sheets = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets`, cookies: { nt_session: cookie } });
    expect(sheets.statusCode).toBe(404);
  });

  it('prints the published snapshot after a registration is withdrawn', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const generated = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/generate`, cookies: { nt_session: cookie } });
    expect(generated.statusCode).toBe(201);
    const planId = generated.json().id as string;
    const firstSlot = await prisma.roundSlot.findFirstOrThrow({ where: { planId } });
    const before = await prisma.roundPlanPlayer.findUniqueOrThrow({ where: { planId_registrationId: { planId, registrationId: firstSlot.registrationId } } });
    const published = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/publish`, payload: { planId }, cookies: { nt_session: cookie } });
    expect(published.statusCode).toBe(200);
    await withdrawRegistration(prisma, event.id, firstSlot.registrationId, new Date());

    const sheets = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets`, cookies: { nt_session: cookie } });
    expect(sheets.statusCode).toBe(200);
    expect((sheets.body.match(/<!doctype html>/gi) ?? [])).toHaveLength(1);
    expect((sheets.body.match(/class="sheet"/g) ?? [])).toHaveLength(4);
    expect(sheets.body).toContain(before.playerName);
    expect(sheets.body).toContain(`>${before.bibNumber}<`);
    expect(sheets.body).not.toContain('parentEmail');
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
