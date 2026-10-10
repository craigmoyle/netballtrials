import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RoundPlan, RoundSlot } from '@prisma/client';
import type { RoundPlanDTO } from '@netball-trials/types';
import type { AppDeps } from '../app';
import { requireAdmin } from '../auth/guard';
import { generateDraftPlan, publishPlan, regenerateFromRound } from './service';

const POSITION_ORDER: Record<string, number> = {
  GS: 0,
  GA: 1,
  WA: 2,
  C: 3,
  WD: 4,
  GD: 5,
  GK: 6,
};

function serializePlan(plan: RoundPlan & { slots: RoundSlot[] }): RoundPlanDTO {
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
    slots,
  };
}

async function loadPlan(deps: AppDeps, eventId: string) {
  return deps.prisma.roundPlan.findFirst({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
    include: { slots: true },
  });
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
      const loaded = await loadPlan(deps, id);
      return reply.code(201).send(serializePlan(loaded ?? { ...result.plan, slots: [] }));
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
      try {
        const plan = await publishPlan(deps.prisma, id);
        const loaded = await loadPlan(deps, id);
        return serializePlan(loaded ?? { ...plan, slots: [] });
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    },
  );

  app.post(
    '/api/admin/events/:id/plan/regenerate',
    { preHandler: requireAdmin(deps) },
    async (req, reply) => {
      const parsed = z.object({ fromRound: z.number().int().min(1) }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_failed' });
      }
      const { id } = req.params as { id: string };
      const result = await regenerateFromRound(deps.prisma, id, parsed.data.fromRound, new Date());
      if (!result.ok) {
        return reply.code(422).send({ error: 'infeasible', gaps: result.gaps });
      }
      const loaded = await loadPlan(deps, id);
      return serializePlan(loaded ?? { ...result.plan, slots: [] });
    },
  );
}
