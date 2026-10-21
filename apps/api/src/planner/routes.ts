import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoundPlan, RoundPlanPlayer, RoundSlot } from '@prisma/client';
import { POSITIONS } from '@netball-trials/types';
import type { ManualRoundInputDTO, ManualSuffixInputDTO, PlanRevisionSummaryDTO, PlannerGapDTO, RoundPlanDTO } from '@netball-trials/types';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { getEventCourtColors } from '../colors/service';
import { getGameRoster, saveManualRoundRevision, saveManualSuffixRevision } from './games';
import { generateDraftPlan, getPlanPreview, publishPlan, regenerateFromRound } from './service';
import { renderBlankGameSheet } from './blank-sheet';
import { renderSelectorSheets } from './sheets';
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

const planSlotSchema = z.object({
  round: z.number().int(),
  court: z.number().int(),
  position: z.enum(POSITIONS),
  team: z.union([z.literal(0), z.literal(1)]),
  registrationId: z.string().min(1),
}).strict();

const manualRoundSchema = z.object({
  sourcePlanId: z.string().min(1),
  slots: z.array(planSlotSchema),
  overrideWarnings: z.boolean().default(false),
}).strict();

const manualSuffixSchema = z.object({
  sourcePlanId: z.string().min(1),
  fromRound: z.number().int().min(1),
  slots: z.array(planSlotSchema),
  removedRegistrationIds: z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length).default([]),
  overrideWarnings: z.boolean().default(false),
}).strict();

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
    gameStartTime: plan.gameStartTime,
    courts: plan.courts,
    windowMinutes: plan.windowMinutes,
    rank1Min: plan.rank1Min,
    rank2Min: plan.rank2Min,
    rank3Min: plan.rank3Min,
    slots,
    players: [...plan.players]
      .sort((a, b) => (a.bibNumber ?? Number.MAX_SAFE_INTEGER) - (b.bibNumber ?? Number.MAX_SAFE_INTEGER))
      .map((player) => ({
        registrationId: player.registrationId,
        playerName: player.playerName,
        bibNumber: player.bibNumber,
        rank1Position: player.rank1Position,
        rank2Position: player.rank2Position,
        rank3Position: player.rank3Position,
        optInExtraPositions: player.optInExtraPositions,
        active: player.active,
      })),
    validationWarnings: Array.isArray(plan.validationWarnings) ? plan.validationWarnings as unknown as PlannerGapDTO[] : [],
  };
}

async function loadPlan(deps: AppDeps, eventId: string, planId?: string, publishedOnly = false) {
  if (planId) {
    return deps.prisma.roundPlan.findFirst({ where: { id: planId, eventId }, include: { slots: true, players: true } });
  }
  const event = await deps.prisma.event.findUnique({ where: { id: eventId }, select: { publishedPlanId: true } });
  if (!event) return null;
  const published = event.publishedPlanId
    ? await deps.prisma.roundPlan.findUnique({ where: { id: event.publishedPlanId }, include: { slots: true, players: true } })
    : null;
  if (publishedOnly) return published;
  // Only a draft newer than, and based on, the active published revision is current.
  const draft = await deps.prisma.roundPlan.findFirst({
    where: {
      eventId,
      status: 'DRAFT',
      revision: { gt: published?.revision ?? 0 },
      OR: [{ sourcePlanId: null }, { sourcePlanId: event.publishedPlanId }],
    },
    orderBy: { revision: 'desc' },
    include: { slots: true, players: true },
  });
  return draft ?? published;
}

export function registerPlannerRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/api/admin/events/:id/plan/generate',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await generateDraftPlan(deps.prisma, id);
      if (!result.ok) {
        return reply.code(422).send({ error: 'infeasible', gaps: result.gaps });
      }
      const loaded = await loadPlan(deps, id, result.plan.id);
      return reply.code(201).send(serializePlan(loaded!));
    },
  );

  app.get('/api/admin/events/:id/plan/preview', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const preview = await getPlanPreview(deps.prisma, id);
    if (!preview) return reply.code(404).send({ error: 'not_found' });
    return preview;
  });

  app.get('/api/admin/events/:id/plan', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const publishedOnly = (req.query as { published?: string }).published === 'true';
    const plan = await loadPlan(deps, id, undefined, publishedOnly);
    if (!plan) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return serializePlan(plan);
  });

  app.get('/api/admin/events/:id/plan/revisions', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    const plans = await deps.prisma.roundPlan.findMany({ where: { eventId: id }, orderBy: { revision: 'desc' } });
    const history: PlanRevisionSummaryDTO[] = plans.map((plan) => ({
      id: plan.id,
      revision: plan.revision,
      status: plan.status,
      sourcePlanId: plan.sourcePlanId,
      frozenThroughRound: plan.frozenThroughRound,
      createdAt: plan.createdAt.toISOString(),
      publishedAt: plan.publishedAt?.toISOString() ?? null,
      validationWarnings: Array.isArray(plan.validationWarnings) ? plan.validationWarnings as unknown as PlannerGapDTO[] : [],
    }));
    return history;
  });

  app.get('/api/admin/events/:id/plan/revisions/:planId', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id, planId } = req.params as { id: string; planId: string };
    const plan = await loadPlan(deps, id, planId);
    if (!plan) return reply.code(404).send({ error: 'not_found' });
    return serializePlan(plan);
  });

  app.get('/api/admin/events/:id/game-roster', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const roster = await getGameRoster(deps.prisma, id);
    if (!roster) return reply.code(404).send({ error: 'not_found' });
    return roster;
  });

  app.post('/api/admin/events/:id/plan/rounds/:round/manual', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = manualRoundSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id, round: rawRound } = req.params as { id: string; round: string };
    const result = await saveManualRoundRevision(deps.prisma, id, Number(rawRound), parsed.data as ManualRoundInputDTO, new Date());
    if (!result.ok) {
      if (result.reason === 'stale_plan') return reply.code(409).send({ error: 'stale_plan' });
      if (result.reason === 'invalid_plan') return reply.code(422).send({ error: 'invalid_plan', errors: result.errors });
      return reply.code(422).send({ error: 'warnings_require_confirmation', warnings: result.warnings });
    }
    return reply.code(201).send(serializePlan(result.plan));
  });

  app.post('/api/admin/events/:id/plan/suffix/manual', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const parsed = manualSuffixSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed' });
    const { id } = req.params as { id: string };
    const result = await saveManualSuffixRevision(deps.prisma, id, parsed.data as ManualSuffixInputDTO, new Date());
    if (!result.ok) {
      if (result.reason === 'stale_plan') return reply.code(409).send({ error: 'stale_plan' });
      if (result.reason === 'invalid_plan') return reply.code(422).send({ error: 'invalid_plan', errors: result.errors });
      return reply.code(422).send({ error: 'warnings_require_confirmation', warnings: result.warnings });
    }
    return reply.code(201).send(serializePlan(result.plan));
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
      const parsed = z.object({
        fromRound: z.number().int().min(1),
        sourcePlanId: z.string().optional(),
        removedRegistrationIds: z.array(z.string().min(1)).refine((ids) => new Set(ids).size === ids.length).default([]),
      }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed' });
      }
      const { id } = req.params as { id: string };
      const result = await regenerateFromRound(deps.prisma, id, parsed.data.fromRound, new Date(), parsed.data.sourcePlanId, parsed.data.removedRegistrationIds);
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
    if (!plan || plan.status !== 'PUBLISHED') {
      return reply.code(404).send({ error: 'not_found' });
    }

    const courtColors = await getEventCourtColors(deps.prisma, id);
    if (!courtColors) return reply.code(404).send({ error: 'not_found' });
    const missingCourts = courtColors.filter((pair) => !pair.teamAColor || !pair.teamBColor).map((pair) => pair.court);
    if (missingCourts.length > 0) return reply.code(409).send({ error: 'court_colors_unassigned', courts: missingCourts });

    const players = plan.players.map((player) => ({
      registrationId: player.registrationId,
      playerName: player.playerName,
      bibNumber: player.bibNumber,
      rank1Position: player.rank1Position,
      rank2Position: player.rank2Position,
      rank3Position: player.rank3Position,
      optInExtraPositions: player.optInExtraPositions,
      active: player.active,
    }));
    const slots: PlanSlot[] = plan.slots.map((slot) => ({
      round: slot.round,
      court: slot.court,
      position: slot.position,
      team: slot.team === 0 ? 0 : 1,
      registrationId: slot.registrationId,
    }));
    const html = renderSelectorSheets({
      event: {
        name: plan.eventName,
        eventDate: plan.eventDate.toISOString().slice(0, 10),
        venue: plan.venue,
      },
      slots,
      players,
      courtColors,
    });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/api/admin/events/:id/sheets/blank', { preHandler: requireAdmin(deps) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await deps.prisma.event.findUnique({ where: { id }, select: { name: true, eventDate: true, venue: true } });
    if (!event) return reply.code(404).send({ error: 'not_found' });
    const html = renderBlankGameSheet({ name: event.name, eventDate: event.eventDate.toISOString().slice(0, 10), venue: event.venue });
    return reply.type('text/html; charset=utf-8').send(html);
  });
}
