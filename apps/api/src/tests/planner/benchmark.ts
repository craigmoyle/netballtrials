// Run from apps/api: npx tsx src/tests/planner/benchmark.ts (no database access).
import { performance } from 'node:perf_hooks';
import { generatePlan, generatePlanFromPrefix } from '../../planner/generate';
import { repeatOpponentPairs } from '../../planner/fairness';
import { runGeneration } from '../../planner/worker';
import { verifyPlan } from '../../planner/verify';
import { COURT_POSITIONS, type PlannerInput } from '../../planner/types';

function inputFor(count: number, courts: number, mixed = false): PlannerInput {
  let randomState = 1;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  return {
    courts, rounds: Math.ceil(count / 14), playMinutes: 8, changeoverMinutes: 2, windowMinutes: 150,
    rank1Min: 1, rank2Min: mixed ? 1 : 0, rank3Min: 0,
    players: Array.from({ length: count }, (_, index) => {
      const first = mixed ? Math.floor(random() * 7) : index % 7;
      const second = mixed ? (first + 1 + Math.floor(random() * 6)) % 7 : 0;
      return {
        registrationId: `p${String(index).padStart(3, '0')}`, name: `Player ${index}`, bibNumber: index + 1,
        rank1: COURT_POSITIONS[first], rank2: mixed && random() < 0.6 ? COURT_POSITIONS[second] : null,
        rank3: null, optInExtra: mixed && random() < 0.1,
      };
    }),
  };
}

for (const [count, courts, windowMinutes] of [[56, 4, 38], [60, 4, 48], [84, 6, 58], [100, 6, 150]]) {
  const input = { ...inputFor(count, courts), windowMinutes };
  const start = performance.now();
  const result = generatePlan(input, 1);
  if (!result.ok || verifyPlan(input, result.plan).length) throw new Error('Invalid fixed benchmark result');
  console.log(JSON.stringify({ mode: 'fixed-sync', count, courts, ms: Math.round(performance.now() - start), ok: result.ok, rounds: result.plan.rounds, repeatedPairs: repeatOpponentPairs(result.plan) }));

  const frozenSlots = result.plan.slots.filter((slot) => slot.round === 1);
  const suffixStart = performance.now();
  const suffix = generatePlanFromPrefix(input, 42, frozenSlots, 2, result.plan.rounds);
  if (!suffix.ok || verifyPlan({ ...input, frozenThroughRound: 1 }, suffix.plan).length) throw new Error('Invalid suffix benchmark result');
  console.log(JSON.stringify({ mode: 'fixed-suffix-sync', count, courts, ms: Math.round(performance.now() - suffixStart), ok: suffix.ok, rounds: suffix.plan.rounds }));
}

const mixed = inputFor(100, 6, true);
for (const mode of ['mixed-sync', 'mixed-worker']) {
  let ticks = 0;
  const interval = setInterval(() => ticks++, 10);
  const start = performance.now();
  const result = mode === 'mixed-sync' ? generatePlan(mixed, 1) : await runGeneration({ input: mixed, seed: 1 });
  clearInterval(interval);
  if (result.ok && verifyPlan(mixed, result.plan).length) throw new Error('Invalid benchmark result');
  console.log(JSON.stringify({ mode, count: 100, courts: 6, ms: Math.round(performance.now() - start), ok: result.ok, eventLoopTicks: ticks }));
}
