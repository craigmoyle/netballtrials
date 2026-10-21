import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';
import { generateDraftPlan, publishPlan, regenerateFromRound } from '../../planner/service';
import { verifyPlan } from '../../planner/verify';
import { seedEventWithPlayers } from '../helpers/planner';
import { withdrawRegistration } from '../../registrations/service';

beforeEach(resetDb);

async function inputForEvent(eventId: string, rounds: number) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const registrations = await prisma.registration.findMany({
    where: { eventId, status: 'PAID', checkedInAt: { not: null } },
    orderBy: { bibNumber: 'asc' },
  });
  const [startHour, startMinute] = event.firstWhistle.split(':').map(Number);
  const [endHour, endMinute] = event.lastWhistle.split(':').map(Number);
  return {
    courts: event.courts,
    rounds,
    playMinutes: event.playMinutes,
    changeoverMinutes: event.changeoverMinutes,
    windowMinutes: endHour * 60 + endMinute - startHour * 60 - startMinute,
    rank1Min: event.rank1Min,
    rank2Min: event.rank2Min,
    rank3Min: event.rank3Min,
    players: registrations.map((registration) => ({
      registrationId: registration.id,
      name: `${registration.playerFirstName} ${registration.playerLastName}`,
      bibNumber: registration.bibNumber ?? 0,
      rank1: registration.rank1Position,
      rank2: registration.rank2Position,
      rank3: registration.rank3Position,
      optInExtra: registration.optInExtraPositions,
    })),
  };
}

function orderedSlots(slots: Array<{ round: number; court: number; position: string; team: number; registrationId: string }>) {
  return [...slots]
    .sort((a, b) => a.round - b.round || a.court - b.court || a.team - b.team || a.position.localeCompare(b.position) || a.registrationId.localeCompare(b.registrationId))
    .map(({ round, court, position, team, registrationId }) => ({ round, court, position, team, registrationId }));
}

describe('plan service', () => {
  it('generates a draft from checked-in players only and snapshots display fields', async () => {
    const event = await seedEventWithPlayers(29, { courts: 2, checkedIn: 28 });
    const result = await generateDraftPlan(prisma, event.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe('DRAFT');
    expect(await prisma.roundSlot.count({ where: { planId: result.plan.id } })).toBe(2 * 2 * 14);
    const players = await prisma.roundPlanPlayer.findMany({ where: { planId: result.plan.id } });
    expect(players).toHaveLength(28);
    const noShow = await prisma.registration.findFirstOrThrow({ where: { eventId: event.id, checkedInAt: null } });
    expect(players.some((player) => player.registrationId === noShow.id)).toBe(false);
  });

  it('does not save a plan when a check-in gap exists', async () => {
    const event = await seedEventWithPlayers(20, { courts: 2, checkedIn: 20 });
    const result = await generateDraftPlan(prisma, event.id, 1);
    expect(result.ok).toBe(false);
    expect(await prisma.roundPlan.count()).toBe(0);
  });

  it('creates a new verified draft revision and preserves the played prefix', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const first = await generateDraftPlan(prisma, event.id, 1);
    if (!first.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, first.plan.id);
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const before = await prisma.roundSlot.findMany({ where: { planId: first.plan.id, round: 1 } });
    const beforePlayers = await prisma.roundPlanPlayer.findMany({ where: { planId: first.plan.id }, orderBy: { registrationId: 'asc' } });
    const regenerated = await regenerateFromRound(prisma, event.id, 2, new Date(), first.plan.id);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;

    expect(regenerated.plan.id).not.toBe(first.plan.id);
    expect(regenerated.plan.revision).toBe(first.plan.revision + 1);
    expect(regenerated.plan.sourcePlanId).toBe(first.plan.id);
    expect(regenerated.plan.status).toBe('DRAFT');
    expect((await prisma.roundPlan.findUniqueOrThrow({ where: { id: first.plan.id } })).status).toBe('PUBLISHED');

    const after = await prisma.roundSlot.findMany({ where: { planId: regenerated.plan.id, round: 1 } });
    expect(orderedSlots(after)).toEqual(orderedSlots(before));
    expect(await prisma.roundPlanPlayer.findMany({ where: { planId: regenerated.plan.id }, orderBy: { registrationId: 'asc' } })).toEqual(
      expect.arrayContaining(beforePlayers.map((player) => expect.objectContaining({ registrationId: player.registrationId, playerName: player.playerName, bibNumber: player.bibNumber }))),
    );
    const plan = await prisma.roundPlan.findUniqueOrThrow({ where: { id: regenerated.plan.id }, include: { slots: true } });
    expect(verifyPlan(await inputForEvent(event.id, plan.rounds), plan as any)).toEqual([]);
  });

  it('does not publish a draft after the checked-in roster changes', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const draft = await generateDraftPlan(prisma, event.id, 1);
    if (!draft.ok) throw new Error('setup failed');
    await prisma.registration.updateMany({
      where: { eventId: event.id, bibNumber: 1 },
      data: { checkedInAt: null },
    });
    const published = await publishPlan(prisma, event.id, draft.plan.id);
    expect(published.ok).toBe(false);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).publishedPlanId).toBeNull();
    expect((await prisma.roundPlan.findUniqueOrThrow({ where: { id: draft.plan.id } })).status).toBe('DRAFT');
  });

  it('publishing the current published revision again is idempotent', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const draft = await generateDraftPlan(prisma, event.id, 1);
    if (!draft.ok) throw new Error('setup failed');
    const first = await publishPlan(prisma, event.id, draft.plan.id);
    const second = await publishPlan(prisma, event.id, draft.plan.id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.plan.publishedAt).toEqual(first.plan.publishedAt);
  });

  it('rejects a late arrival that cannot fit the frozen prefix and leaves the published revision unchanged', async () => {
    const event = await seedEventWithPlayers(30, { courts: 2, checkedIn: 30, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
    await prisma.event.update({ where: { id: event.id }, data: { lastWhistle: '09:28' } });
    const first = await generateDraftPlan(prisma, event.id, 1);
    if (!first.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, first.plan.id);
    if (!published.ok) throw new Error('publish setup failed');
    const frozenBefore = await prisma.roundSlot.findMany({ where: { planId: first.plan.id, round: { lt: 3 } } });
    const late = await prisma.registration.create({
      data: {
        eventId: event.id, playerFirstName: 'Late', playerLastName: 'Arrival', playerNameNormalized: 'late arrival',
        dateOfBirth: new Date('2011-04-02T00:00:00Z'), parentName: 'Parent', parentEmail: 'late@example.com',
        parentMobile: '0400000000', memberAssociation: 'MENA', rank1Position: 'GS', eligibilityConfirmedAt: new Date(),
        amountCents: 3500, policyReference: 'x', expiresAt: new Date(Date.now() + 86400000), status: 'PAID',
        checkedInAt: new Date(), bibNumber: 31,
      },
    });

    const result = await regenerateFromRound(prisma, event.id, 3, new Date(), first.plan.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gaps.length).toBeGreaterThan(0);
    expect(await prisma.roundPlan.count({ where: { eventId: event.id } })).toBe(1);
    expect((await prisma.roundPlan.findUniqueOrThrow({ where: { id: first.plan.id } })).status).toBe('PUBLISHED');
    expect(orderedSlots(await prisma.roundSlot.findMany({ where: { planId: first.plan.id, round: { lt: 3 } } })))
      .toEqual(orderedSlots(frozenBefore));
    expect(late.status).toBe('PAID');
  });

  it('freezes played rounds and excludes a withdrawn player from the regenerated suffix', async () => {
    const event = await seedEventWithPlayers(30, { courts: 2, checkedIn: 30, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
    const original = await generateDraftPlan(prisma, event.id, 1);
    if (!original.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, original.plan.id);
    if (!published.ok) throw new Error('publish setup failed');
    const frozenBefore = await prisma.roundSlot.findMany({ where: { planId: original.plan.id, round: { lt: 3 } } });
    const departing = await prisma.registration.findFirstOrThrow({ where: { eventId: event.id, status: 'PAID' }, orderBy: { playerFirstName: 'asc' } });
    await prisma.registration.update({ where: { id: departing.id }, data: { status: 'WITHDRAWN', checkedInAt: null, bibNumber: null } });

    const regenerated = await regenerateFromRound(prisma, event.id, 3, new Date(1_000_000), original.plan.id);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;
    const revision = await prisma.roundPlan.findUniqueOrThrow({ where: { id: regenerated.plan.id }, include: { slots: true, players: true } });
    expect(revision.slots.some((slot) => slot.registrationId === departing.id && slot.round >= 3)).toBe(false);
    expect(orderedSlots(revision.slots.filter((slot) => slot.round < 3))).toEqual(orderedSlots(frozenBefore));
    const snapshotInput = {
      courts: revision.courts,
      rounds: revision.rounds,
      playMinutes: revision.playMinutes,
      changeoverMinutes: revision.changeoverMinutes,
      windowMinutes: revision.windowMinutes,
      rank1Min: revision.rank1Min,
      rank2Min: revision.rank2Min,
      rank3Min: revision.rank3Min,
      frozenThroughRound: revision.frozenThroughRound,
      inactiveRegistrationIds: revision.players.filter((player) => !player.active).map((player) => player.registrationId),
      players: revision.players.map((player) => ({
        registrationId: player.registrationId,
        name: player.playerName,
        bibNumber: player.bibNumber ?? 0,
        rank1: player.rank1Position,
        rank2: player.rank2Position,
        rank3: player.rank3Position,
        optInExtra: player.optInExtraPositions,
      })),
    };
    expect(verifyPlan(snapshotInput, revision as any)).toEqual([]);
  });

  it('keeps a withdrawn player in the frozen snapshot but excludes them from future rounds', async () => {
    const event = await seedEventWithPlayers(30, { courts: 2, checkedIn: 30, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
    await prisma.registration.updateMany({ where: { eventId: event.id }, data: { optInExtraPositions: true } });
    const first = await generateDraftPlan(prisma, event.id, 1);
    if (!first.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, first.plan.id);
    if (!published.ok) throw new Error('publish setup failed');

    const previousSlots = await prisma.roundSlot.findMany({ where: { planId: first.plan.id, round: { lt: 3 } } });
    const playedRegistrationId = previousSlots[0].registrationId;
    await withdrawRegistration(prisma, event.id, playedRegistrationId, new Date());
    const regenerated = await regenerateFromRound(prisma, event.id, 3, new Date(), first.plan.id);
    expect(regenerated.ok).toBe(true);
    if (!regenerated.ok) return;

    const revision = await prisma.roundPlan.findUniqueOrThrow({ where: { id: regenerated.plan.id }, include: { slots: true, players: true } });
    expect(revision.slots.some((slot) => slot.registrationId === playedRegistrationId && slot.round >= 3)).toBe(false);
    expect(revision.players.find((player) => player.registrationId === playedRegistrationId)?.active).toBe(false);
    expect(orderedSlots(revision.slots.filter((slot) => slot.round < 3))).toEqual(orderedSlots(previousSlots));
    const snapshotInput = {
      courts: revision.courts,
      rounds: revision.rounds,
      playMinutes: revision.playMinutes,
      changeoverMinutes: revision.changeoverMinutes,
      windowMinutes: revision.windowMinutes,
      rank1Min: revision.rank1Min,
      rank2Min: revision.rank2Min,
      rank3Min: revision.rank3Min,
      frozenThroughRound: revision.frozenThroughRound,
      inactiveRegistrationIds: revision.players.filter((player) => !player.active).map((player) => player.registrationId),
      players: revision.players.map((player) => ({
        registrationId: player.registrationId,
        name: player.playerName,
        bibNumber: player.bibNumber ?? 0,
        rank1: player.rank1Position,
        rank2: player.rank2Position,
        rank3: player.rank3Position,
        optInExtra: player.optInExtraPositions,
      })),
    };
    expect(verifyPlan(snapshotInput, revision as any)).toEqual([]);
  });

  it('rebuilds the suffix without assigning a selected early leaver or mutating registration history', async () => {
    const event = await seedEventWithPlayers(30, { courts: 2, checkedIn: 30, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
    await prisma.registration.updateMany({ where: { eventId: event.id }, data: { optInExtraPositions: true } });
    const draft = await generateDraftPlan(prisma, event.id, 31);
    if (!draft.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, draft.plan.id);
    if (!published.ok) throw new Error('publish setup failed');
    const sourceSlots = await prisma.roundSlot.findMany({ where: { planId: published.plan.id } });
    const removedId = sourceSlots.find((slot) => slot.round === 1 && sourceSlots.some((later) => later.round >= 2 && later.registrationId === slot.registrationId))?.registrationId;
    expect(removedId).toBeTruthy();
    const registrationBefore = await prisma.registration.findUniqueOrThrow({ where: { id: removedId! } });
    const prefixBefore = orderedSlots(sourceSlots.filter((slot) => slot.round < 2));

    const rebuilt = await regenerateFromRound(prisma, event.id, 2, new Date('2027-09-12T01:00:00Z'), published.plan.id, [removedId!]);

    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const revision = await prisma.roundPlan.findUniqueOrThrow({ where: { id: rebuilt.plan.id }, include: { slots: true, players: true } });
    expect(revision.status).toBe('DRAFT');
    expect(revision.frozenThroughRound).toBe(1);
    expect(orderedSlots(revision.slots.filter((slot) => slot.round < 2))).toEqual(prefixBefore);
    expect(revision.slots.some((slot) => slot.registrationId === removedId && slot.round >= 2)).toBe(false);
    expect(revision.players.find((player) => player.registrationId === removedId)?.active).toBe(false);
    const registrationAfter = await prisma.registration.findUniqueOrThrow({ where: { id: removedId! } });
    expect(registrationAfter).toMatchObject({ status: registrationBefore.status, bibNumber: registrationBefore.bibNumber, checkedInAt: registrationBefore.checkedInAt });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).publishedPlanId).toBe(published.plan.id);
    const republished = await publishPlan(prisma, event.id, rebuilt.plan.id);
    expect(republished.ok, JSON.stringify(republished)).toBe(true);
    if (!republished.ok) return;
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).publishedPlanId).toBe(republished.plan.id);
  });

  it('does not create a suffix draft when early leavers make the remaining roster too small', async () => {
    const event = await seedEventWithPlayers(30, { courts: 2, checkedIn: 30, rank1Min: 1, rank2Min: 0, rank3Min: 0 });
    await prisma.registration.updateMany({ where: { eventId: event.id }, data: { optInExtraPositions: true } });
    const draft = await generateDraftPlan(prisma, event.id, 41);
    if (!draft.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, draft.plan.id);
    if (!published.ok) throw new Error('publish setup failed');
    const removedIds = (await prisma.roundPlanPlayer.findMany({ where: { planId: published.plan.id }, take: 3 })).map((player) => player.registrationId);

    const rebuilt = await regenerateFromRound(prisma, event.id, 2, new Date(), published.plan.id, removedIds);

    expect(rebuilt.ok).toBe(false);
    expect(await prisma.roundPlan.count({ where: { eventId: event.id } })).toBe(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).publishedPlanId).toBe(published.plan.id);
    expect(await prisma.registration.count({ where: { id: { in: removedIds }, status: 'PAID' } })).toBe(3);
  });

  it('returns the published plan when two admins publish the same draft concurrently', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const draft = await generateDraftPlan(prisma, event.id, 1);
    if (!draft.ok) throw new Error('setup failed');
    const [first, second] = await Promise.all([publishPlan(prisma, event.id, draft.plan.id), publishPlan(prisma, event.id, draft.plan.id)]);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    if (first.ok && second.ok) expect(second.plan.id).toBe(first.plan.id);
  });

  it('refuses to regenerate rounds that are already frozen', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const first = await generateDraftPlan(prisma, event.id, 1);
    if (!first.ok) throw new Error('setup failed');
    if (!(await publishPlan(prisma, event.id, first.plan.id)).ok) throw new Error('publish setup failed');
    const rebuilt = await regenerateFromRound(prisma, event.id, 2, new Date(), first.plan.id);
    if (!rebuilt.ok) throw new Error('regenerate setup failed');
    const published = await publishPlan(prisma, event.id, rebuilt.plan.id);
    if (!published.ok) throw new Error('republish setup failed');
    const countBefore = await prisma.roundPlan.count({ where: { eventId: event.id } });

    const result = await regenerateFromRound(prisma, event.id, 1, new Date(), published.plan.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gaps[0].message).toMatch(/round 1 is already played and frozen/i);
    expect(await prisma.roundPlan.count({ where: { eventId: event.id } })).toBe(countBefore);
  });

  it('regenerates from the active published revision when no source is given', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const first = await generateDraftPlan(prisma, event.id, 1);
    if (!first.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, first.plan.id);
    if (!published.ok) throw new Error('publish setup failed');
    const result = await regenerateFromRound(prisma, event.id, 2, new Date());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.plan.sourcePlanId).toBe(published.plan.id);
  });

  it('refuses an invalid regeneration round without changing the source revision', async () => {
    const event = await seedEventWithPlayers(28, { courts: 2, checkedIn: 28 });
    const first = await generateDraftPlan(prisma, event.id, 1);
    if (!first.ok) throw new Error('setup failed');
    const published = await publishPlan(prisma, event.id, first.plan.id);
    if (!published.ok) throw new Error('publish setup failed');
    const result = await regenerateFromRound(prisma, event.id, first.plan.rounds + 1, new Date(), first.plan.id);
    expect(result.ok).toBe(false);
    expect(await prisma.roundPlan.count({ where: { eventId: event.id } })).toBe(1);
    expect((await prisma.roundPlan.findUniqueOrThrow({ where: { id: first.plan.id } })).status).toBe('PUBLISHED');
  });
});
