import type { PrismaClient, RoundPlan } from '@prisma/client';
import { computeMinimumRounds } from './minimum';
import { generatePlan } from './generate';
import type { PlannerGap, PlannerInput, PlannerPlayer } from './types';

export type GenerateResult = { ok: true; plan: RoundPlan } | { ok: false; gaps: PlannerGap[] };

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

async function buildInput(
  prisma: PrismaClient,
  eventId: string,
): Promise<{ event: { id: string; playMinutes: number; changeoverMinutes: number }; input: PlannerInput } | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return null;
  }

  const registrations = await prisma.registration.findMany({
    where: { eventId, status: 'PAID', checkedInAt: { not: null } },
    orderBy: { bibNumber: 'asc' },
  });

  const players: PlannerPlayer[] = registrations.map((registration) => ({
    registrationId: registration.id,
    name: `${registration.playerFirstName} ${registration.playerLastName}`,
    bibNumber: registration.bibNumber ?? 0,
    rank1: registration.rank1Position,
    rank2: registration.rank2Position,
    rank3: registration.rank3Position,
    optInExtra: registration.optInExtraPositions,
  }));

  const windowMinutes = Math.max(1, toMinutes(event.lastWhistle) - toMinutes(event.firstWhistle));
  const base = {
    courts: event.courts,
    playMinutes: event.playMinutes,
    changeoverMinutes: event.changeoverMinutes,
    windowMinutes,
    rank1Min: event.rank1Min,
    rank2Min: event.rank2Min,
    rank3Min: event.rank3Min,
    players,
  };

  return {
    event: {
      id: event.id,
      playMinutes: event.playMinutes,
      changeoverMinutes: event.changeoverMinutes,
    },
    input: { ...base, rounds: computeMinimumRounds(base) },
  };
}

export async function generateDraftPlan(
  prisma: PrismaClient,
  eventId: string,
  _now: Date,
  seed = 1,
): Promise<GenerateResult> {
  const built = await buildInput(prisma, eventId);
  if (!built) {
    throw new Error('event not found');
  }

  const result = generatePlan(built.input, seed);
  if (!result.ok) {
    return { ok: false, gaps: result.gaps };
  }

  const plan = await prisma.$transaction(async (tx) => {
    await tx.roundPlan.deleteMany({ where: { eventId, status: 'DRAFT' } });
    const created = await tx.roundPlan.create({
      data: {
        eventId,
        seed,
        status: 'DRAFT',
        rounds: result.plan.rounds,
        playMinutes: built.event.playMinutes,
        changeoverMinutes: built.event.changeoverMinutes,
      },
    });
    await tx.roundSlot.createMany({
      data: result.plan.slots.map((slot) => ({
        planId: created.id,
        round: slot.round,
        court: slot.court,
        position: slot.position,
        team: slot.team,
        registrationId: slot.registrationId,
      })),
    });
    return created;
  });

  return { ok: true, plan };
}

export async function publishPlan(prisma: PrismaClient, eventId: string): Promise<RoundPlan> {
  const plan = await prisma.roundPlan.findFirst({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
  });
  if (!plan) {
    throw new Error('no plan to publish');
  }
  if (plan.status === 'PUBLISHED') {
    return plan;
  }
  return prisma.roundPlan.update({
    where: { id: plan.id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
}

export async function regenerateFromRound(
  prisma: PrismaClient,
  eventId: string,
  fromRound: number,
  now: Date,
): Promise<GenerateResult> {
  const built = await buildInput(prisma, eventId);
  if (!built) {
    throw new Error('event not found');
  }

  const seed = Math.floor(now.getTime() / 1000) % 1_000_000;
  const result = generatePlan(built.input, seed);
  if (!result.ok) {
    return { ok: false, gaps: result.gaps };
  }

  const existing = await prisma.roundPlan.findFirst({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
  });
  const generated = result.plan.slots.filter((slot) => slot.round >= fromRound);

  const plan = await prisma.$transaction(async (tx) => {
    if (!existing) {
      const created = await tx.roundPlan.create({
        data: {
          eventId,
          seed,
          status: 'DRAFT',
          rounds: result.plan.rounds,
          playMinutes: built.event.playMinutes,
          changeoverMinutes: built.event.changeoverMinutes,
        },
      });
      await tx.roundSlot.createMany({
        data: result.plan.slots.map((slot) => ({
          planId: created.id,
          round: slot.round,
          court: slot.court,
          position: slot.position,
          team: slot.team,
          registrationId: slot.registrationId,
        })),
      });
      return created;
    }

    await tx.roundSlot.deleteMany({ where: { planId: existing.id, round: { gte: fromRound } } });
    await tx.roundSlot.createMany({
      data: generated.map((slot) => ({
        planId: existing.id,
        round: slot.round,
        court: slot.court,
        position: slot.position,
        team: slot.team,
        registrationId: slot.registrationId,
      })),
    });
    return tx.roundPlan.update({
      where: { id: existing.id },
      data: {
        seed,
        rounds: result.plan.rounds,
        playMinutes: built.event.playMinutes,
        changeoverMinutes: built.event.changeoverMinutes,
      },
    });
  });

  return { ok: true, plan };
}
