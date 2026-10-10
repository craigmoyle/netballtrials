import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoundPlan, RoundPlanPlayer, RoundSlot } from '@prisma/client';
import type { RoundPlanDTO } from '@netball-trials/types';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { generateDraftPlan, publishPlan, regenerateFromRound } from './service';
import { renderSelectorSheet } from './sheets';
import type { PlanSlot } from './types';

const POSITION_ORDER: Record<string, number> = {
  GS: 0,
  GA: 1,
  WA: 2,
  C: 3,
  WD: 4,
  GD: 5,
  GK: 6,
};

function serializePlan(plan: RoundPlan & { slots: RoundSlot[]; players: RoundPlanPlayer[] }): RoundPlanDTO {
  const playersById = new Map(plan.players.map((player) => [player.registrationId, player]));
  const slots = [...plan.slots]
    .sort(
      (a, b) =>
        a.round - b.round ||
        a.court - b.court ||
        a.team - b.team ||
        POSITION_ORDER[a.position] - POSITION_ORDER[b.position],
    )
    .map((slot) => ({
      id: slot.id,
      round: slot.round,
      court: slot.court,
      position: slot.position,
      team: slot.team,
      registrationId: slot.registrationId,
      playerName: playersById.get(slot.registrationId)?.playerName ?? 'Former participant',
      bibNumber: playersById.get(slot.registrationId)?.bibNumber ?? null,
    }));

  return {
    id: plan.id,
    eventId: plan.eventId,
    status: plan.status,
    seed: plan.seed,
    rounds: plan.rounds,
    playMinutes: plan.playMinutes,
    changeoverMinutes: plan.changeoverMinutes,
    createdAt: plan.createdAt.toISOString(),
    publishedAt: plan.publishedAt ? plan.publishedAt.toISOString() : null,
    revision: plan.revision,
    sourcePlanId: plan.sourcePlanId,
    frozenThroughRound: plan.frozenThroughRound,
    eventName: plan.eventName,
    eventDate: plan.eventDate.toISOString(),
    venue: plan.venue,
    firstWhistle: plan.firstWhistle,
    courts: plan.courts,
    windowMinutes: plan.windowMinutes,
    rank1Min: plan.rank1Min,
    rank2Min: plan.rank2Min,
    rank3Min: plan.rank3Min,
    slots,
  };
}

async function loadPlan(deps: AppDeps, eventId: string, planId?: string, publishedOnly = false) {
  if (planId) {
    return deps.prisma.roundPlan.findFirst({ where: { id: planId, eventId }, include: { slots: true, players: true } });
  }
  const event = await deps.prisma.event.findUnique({ where: { id: eventId }, select: { publishedPlanId: true } });
  if (!event) return null;
  if (publishedOnly) {
    return event.publishedPlanId
      ? deps.prisma.roundPlan.findUnique({ where: { id: event.publishedPlanId }, include: { slots: true, players: true } })
      : null;
  }
  const draft = await deps.prisma.roundPlan.findFirst({
    where: { eventId, status: 'DRAFT' },
    orderBy: { revision: 'desc' },
    include: { slots: true, players: true },
  });
  if (draft) return draft;
  return event.publishedPlanId
    ? deps.prisma.roundPlan.findUnique({ where: { id: event.publishedPlanId }, include: { slots: true, players: true } })
    : null;
}

export function registerPlannerRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/api/admin/events/:id/plan/generate',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await generateDraftPlan(deps.prisma, id, new Date());
      if (!result.ok) {
        return reply.code(422).send({ error: 'infeasible', gaps: result.gaps });
      }
      const loaded = await loadPlan(deps, id, result.plan.id);
      return reply.code(201).send(serializePlan(loaded!));
    },
  );

  app.get('/api/admin/events/:id/plan', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = await loadPlan(deps, id);
    if (!plan) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return serializePlan(plan);
  });

  app.post(
    '/api/admin/events/:id/plan/publish',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = z.object({ planId: z.string().optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
      const result = await publishPlan(deps.prisma, id, parsed.data.planId);
      if (!result.ok) return reply.code(422).send({ error: 'infeasible', gaps: result.gaps });
      const loaded = await loadPlan(deps, id, result.plan.id);
      return reply.code(200).send(serializePlan(loaded!));
    },
  );

  app.post(
    '/api/admin/events/:id/plan/regenerate',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const parsed = z.object({ fromRound: z.number().int().min(1), sourcePlanId: z.string().optional() }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed' });
      }
      const { id } = req.params as { id: string };
      const result = await regenerateFromRound(deps.prisma, id, parsed.data.fromRound, new Date(), parsed.data.sourcePlanId);
      if (!result.ok) {
        return reply.code(422).send({ error: 'infeasible', gaps: result.gaps });
      }
      const loaded = await loadPlan(deps, id, result.plan.id);
      return serializePlan(loaded!);
    },
  );

  app.get('/api/admin/events/:id/sheets', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const plan = await loadPlan(deps, id, undefined, true);
    const event = await deps.prisma.event.findUnique({ where: { id } });
    if (!plan || !event) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const registrations = await deps.prisma.registration.findMany({ where: { eventId: id } });
    const players = registrations.map((registration) => ({
      registrationId: registration.id,
      name: `${registration.playerFirstName} ${registration.playerLastName}`,
      bibNumber: registration.bibNumber ?? 0,
      rank1: registration.rank1Position,
      rank2: registration.rank2Position,
      rank3: registration.rank3Position,
      optInExtra: registration.optInExtraPositions,
    }));

    const rounds = [...new Set(plan.slots.map((slot) => slot.round))].sort((a, b) => a - b);
    const courts = [...new Set(plan.slots.map((slot) => slot.court))].sort((a, b) => a - b);
    const sheets: string[] = [];
    for (const round of rounds) {
      for (const court of courts) {
        const slots = plan.slots.filter((slot) => slot.round === round && slot.court === court);
        if (slots.length === 0) {
          continue;
        }
        const sheetSlots: PlanSlot[] = slots.map((slot) => ({
          round: slot.round,
          court: slot.court,
          position: slot.position,
          team: slot.team === 0 ? 0 : 1,
          registrationId: slot.registrationId,
        }));
        sheets.push(
          renderSelectorSheet({
            event: {
              name: event.name,
              eventDate: event.eventDate.toISOString().slice(0, 10),
              venue: event.venue,
            },
            round,
            court,
            slots: sheetSlots,
            players,
          }),
        );
      }
    }
    return reply.type('text/html').send(sheets.join('\n'));
  });
}
