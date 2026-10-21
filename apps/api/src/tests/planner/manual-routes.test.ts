import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { signInAsNewAdmin } from '../helpers/auth';
import { eventFixture, registrationFixture } from '../helpers/fixtures';
import { seedEventWithPlayers } from '../helpers/planner';
import { generateDraftPlan, publishPlan } from '../../planner/service';

const app = createApp();
let eventId: string;
let planId: string;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await signInAsNewAdmin(app, 'manual-routes-admin@example.com');
  const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
  eventId = event.id;
  const draft = await generateDraftPlan(prisma, event.id, 17);
  if (!draft.ok) throw new Error('manual route fixture is infeasible');
  const published = await publishPlan(prisma, event.id, draft.plan.id);
  if (!published.ok) throw new Error('manual route fixture did not publish');
  planId = published.plan.id;
  await prisma.registration.create({ data: registrationFixture(event.id, {
    playerFirstName: 'Pending', playerLastName: 'Player', playerNameNormalized: 'pending player', status: 'PENDING',
    checkedInAt: null, bibNumber: null,
  }) });
});

describe('manual game-plan read routes', () => {
  it('requires an Admin session for plan history, revisions and the eligible game roster', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions/${planId}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/game-roster` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/plan/rounds/1/manual`, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/admin/events/${eventId}/plan/suffix/manual`, payload: {} })).statusCode).toBe(401);
  });

  it('lists revisions and returns an immutable revision with player snapshots and warnings', async () => {
    const history = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions`, cookies: { nt_session: cookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toHaveLength(1);
    expect(history.json()[0]).toMatchObject({ id: planId, revision: 1, status: 'PUBLISHED', sourcePlanId: null });

    const detail = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions/${planId}`, cookies: { nt_session: cookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: planId, status: 'PUBLISHED', validationWarnings: [],
      players: expect.arrayContaining([expect.objectContaining({ playerName: 'Player0 Test', bibNumber: 1, active: true })]),
    });
    expect(JSON.stringify(detail.json())).not.toMatch(/parentEmail|parentMobile|amountCents|checkoutSessionId/);
  });

  it('keeps prior revisions readable and unchanged after a manual save', async () => {
    const slotOrder = [{ court: 'asc' as const }, { position: 'asc' as const }, { team: 'asc' as const }];
    const sourceSlots = await prisma.roundSlot.findMany({ where: { planId, round: 1 }, orderBy: slotOrder });
    const before = sourceSlots.map(({ round, court, position, team, registrationId }) => ({ round, court, position, team, registrationId }));
    const saved = await app.inject({
      method: 'POST', url: `/api/admin/events/${eventId}/plan/rounds/1/manual`, cookies: { nt_session: cookie },
      payload: { sourcePlanId: planId, slots: before, overrideWarnings: false },
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().id).not.toBe(planId);

    const history = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions`, cookies: { nt_session: cookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toHaveLength(2);
    expect(history.json()[0].id).toBe(saved.json().id);
    expect(history.json()[1].id).toBe(planId);
    const prior = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions/${planId}`, cookies: { nt_session: cookie } });
    expect(prior.statusCode).toBe(200);
    expect(prior.json().revision).toBe(1);
    expect((await prisma.roundSlot.findMany({ where: { planId }, orderBy: slotOrder })).filter((slot) => slot.round === 1).map(({ round, court, position, team, registrationId }) => ({ round, court, position, team, registrationId }))).toEqual(before);
  });

  it('returns only paid, checked-in player fields for the available game roster', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/game-roster`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(28);
    expect(response.json()).toContainEqual(expect.objectContaining({ registrationId: expect.any(String), playerName: 'Player0 Test', bibNumber: 1 }));
    expect(JSON.stringify(response.json())).not.toMatch(/parentEmail|parentMobile|amountCents|checkoutSessionId|status/);
  });

  it('adds a newly checked-in paid player to the eligible roster and excludes other statuses', async () => {
    const late = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Late', playerLastName: 'Arrival', playerNameNormalized: 'late arrival',
      status: 'PAID', checkedInAt: new Date(), bibNumber: 29,
    }) });
    const failed = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Failed', playerLastName: 'Payment', playerNameNormalized: 'failed payment',
      status: 'FAILED', checkedInAt: new Date(), bibNumber: 30,
    }) });
    const unchecked = await prisma.registration.create({ data: registrationFixture(eventId, {
      playerFirstName: 'Not', playerLastName: 'Checked', playerNameNormalized: 'not checked',
      status: 'PAID', checkedInAt: null, bibNumber: null,
    }) });

    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/game-roster`, cookies: { nt_session: cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(29);
    expect(response.json()).toContainEqual(expect.objectContaining({ registrationId: late.id, playerName: 'Late Arrival', bibNumber: 29 }));
    expect(response.json().some((player: { registrationId: string }) => player.registrationId === failed.id || player.registrationId === unchecked.id)).toBe(false);
    expect(JSON.stringify(response.json())).not.toMatch(/parentEmail|parentMobile|amountCents|status/);
  });

  it('does not expose a revision belonging to another event', async () => {
    const ownRevision = await app.inject({ method: 'GET', url: `/api/admin/events/${eventId}/plan/revisions/${planId}`, cookies: { nt_session: cookie } });
    expect(ownRevision.statusCode).toBe(200);
    const other = await prisma.event.create({ data: eventFixture({ name: 'Other' }) });
    expect(other.id).not.toBe(eventId);
    const response = await app.inject({ method: 'GET', url: `/api/admin/events/${other.id}/plan/revisions/${planId}`, cookies: { nt_session: cookie } });
    expect(response.statusCode).toBe(404);
  });
});
