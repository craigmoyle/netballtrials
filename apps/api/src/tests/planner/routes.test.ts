import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { seedEventWithPlayers } from '../helpers/planner';
import { withdrawRegistration } from '../../registrations/service';

const app = createApp();

beforeEach(resetDb);

async function configureCourtColors(eventId: string, courts: Array<[number, string, string]> = [[1, 'White', 'Black'], [2, 'Grey', 'Orange']]) {
  const names = [...new Set(courts.flatMap(([, teamA, teamB]) => [teamA, teamB]))];
  const colors = await prisma.bibColor.findMany({ where: { name: { in: names } }, select: { id: true, name: true } });
  const ids = new Map(colors.map((color) => [color.name, color.id]));
  await prisma.eventCourtColor.createMany({ data: courts.map(([court, teamA, teamB]) => ({
    eventId, court, teamAColorId: ids.get(teamA)!, teamBColorId: ids.get(teamB)!,
  })) });
}

describe('planner routes', () => {
  it('requires an admin session', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/events/x/plan/generate' })).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/events/x/sheets' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/events/x/sheets/blank' })).statusCode).toBe(401);
  });
  it('previews the lower bound and exposes a published-only plan for printing', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const preview = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/plan/preview`, cookies: { nt_session: cookie } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ checkedInPlayers: 28, minimumRounds: 2, requiredMinutes: 18, windowMinutes: 150, fitsTimeWindow: true });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/plan?published=true`, cookies: { nt_session: cookie } })).statusCode).toBe(404);
    const generated = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/generate`, cookies: { nt_session: cookie } });
    expect(generated.statusCode).toBe(201);
    const published = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/publish`, cookies: { nt_session: cookie } });
    expect(published.statusCode).toBe(200);
    const publishedOnly = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/plan?published=true`, cookies: { nt_session: cookie } });
    expect(publishedOnly.statusCode).toBe(200);
    expect(publishedOnly.json()).toMatchObject({ id: published.json().id, status: 'PUBLISHED' });
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
    expect(read.json().players).toHaveLength(28);
    expect(read.json().validationWarnings).toEqual([]);
    expect(JSON.stringify(read.json())).not.toMatch(/parentEmail|parentMobile|amountCents/);
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

  it('serves a blank game sheet without a plan and protects the route', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(0, { courts: 2 });
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets`, cookies: { nt_session: cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets/blank` })).statusCode).toBe(401);
    const blank = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets/blank`, cookies: { nt_session: cookie } });
    expect(blank.statusCode).toBe(200);
    expect(blank.headers['content-type']).toContain('text/html');
    expect((blank.body.match(/class="sheet"/g) ?? [])).toHaveLength(1);
    expect(blank.body).toContain('Round:');
    expect((await app.inject({ method: 'GET', url: '/api/admin/events/not-an-event/sheets/blank', cookies: { nt_session: cookie } })).statusCode).toBe(404);
  });

  it('refuses selector sheets when a published plan has an uncolored court', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const generated = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/generate`, cookies: { nt_session: cookie } });
    const published = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/publish`, payload: { planId: generated.json().id }, cookies: { nt_session: cookie } });
    expect(published.statusCode).toBe(200);
    await configureCourtColors(event.id, [[1, 'White', 'Black']]);

    const sheets = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets`, cookies: { nt_session: cookie } });
    expect(sheets.statusCode).toBe(409);
    expect(sheets.json()).toEqual({ error: 'court_colors_unassigned', courts: [2] });
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

    await configureCourtColors(event.id);
    const sheets = await app.inject({ method: 'GET', url: `/api/admin/events/${event.id}/sheets`, cookies: { nt_session: cookie } });
    expect(sheets.statusCode).toBe(200);
    expect(sheets.body).toContain('White');
    expect(sheets.body).toContain('Black');
    expect(sheets.body).toContain('Grey');
    expect(sheets.body).toContain('Orange');
    expect(sheets.body).toContain('selector-print__color-swatch');
    expect(sheets.body).toContain('Choices');
    expect(sheets.body).toContain('Rating');
    expect(sheets.body).toContain('Notes/Feedback');
    expect((sheets.body.match(/<!doctype html>/gi) ?? [])).toHaveLength(1);
    expect((sheets.body.match(/class="sheet"/g) ?? [])).toHaveLength(4);
    expect(sheets.body).toContain(before.playerName);
    expect(sheets.body).toContain(`>${before.bibNumber}<`);
    expect(sheets.body).toContain('<th scope="col">Number</th>');
    expect(sheets.body).not.toContain('parentEmail');
  });

  it('accepts explicit early-leaver IDs for an automatic suffix rebuild without changing registrations', async () => {
    const cookie = await signInAsNewAdmin(app, 'admin@example.com');
    const event = await seedEventWithPlayers(30, { courts: 2, checkedIn: 30, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
    await prisma.registration.updateMany({ where: { eventId: event.id }, data: { optInExtraPositions: true } });
    const generated = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/generate`, cookies: { nt_session: cookie } });
    expect(generated.statusCode).toBe(201);
    const published = await app.inject({ method: 'POST', url: `/api/admin/events/${event.id}/plan/publish`, payload: { planId: generated.json().id }, cookies: { nt_session: cookie } });
    expect(published.statusCode).toBe(200);
    const sourcePlanId = published.json().id as string;
    const sourceSlots = await prisma.roundSlot.findMany({ where: { planId: sourcePlanId } });
    const removedId = sourceSlots.find((slot) => slot.round === 1 && sourceSlots.some((later) => later.round >= 2 && later.registrationId === slot.registrationId))!.registrationId;
    const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: removedId } });

    const response = await app.inject({
      method: 'POST', url: `/api/admin/events/${event.id}/plan/regenerate`, cookies: { nt_session: cookie },
      payload: { fromRound: 2, sourcePlanId, removedRegistrationIds: [removedId] },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'DRAFT', sourcePlanId, frozenThroughRound: 1 });
    expect(response.json().slots.some((slot: { registrationId: string; round: number }) => slot.registrationId === removedId && slot.round >= 2)).toBe(false);
    const registrationAfter = await prisma.registration.findUniqueOrThrow({ where: { id: removedId } });
    expect(registrationAfter).toMatchObject({ status: registrationBefore.status, bibNumber: registrationBefore.bibNumber, checkedInAt: registrationBefore.checkedInAt });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).publishedPlanId).toBe(sourcePlanId);
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
