import { Worker } from 'node:worker_threads';
import type { PlannerInput, PlannerResult, PlanSlot } from './types';

type GenerationJob = { input: PlannerInput; seed: number } & (
  | { fromRound?: never; frozenSlots?: never; minimumTotalRounds?: never }
  | { fromRound: number; frozenSlots: PlanSlot[]; minimumTotalRounds: number }
);

let running = false;
const DEADLINE_MS = 30_000;

// One CPU job per API process, no unbounded request queue. tsImport also works on
// Node 22, where workers cannot load our extensionless TypeScript imports natively.
export async function runGeneration(job: GenerationJob): Promise<PlannerResult> {
  if (running) return { ok: false, gaps: [{ code: 'no_solution', message: 'The planner is busy. Please try again after the current generation finishes.' }] };
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { tsImport } = await import('tsx/esm/api');
      const generator = await tsImport(workerData.moduleUrl, workerData.moduleUrl);
      const job = workerData.job;
      parentPort.postMessage(job.fromRound === undefined
        ? generator.generatePlan(job.input, job.seed)
        : generator.generatePlanFromPrefix(job.input, job.seed, job.frozenSlots, job.fromRound, job.minimumTotalRounds));
    })();
  `, {
    eval: true,
    execArgv: [],
    workerData: { job, moduleUrl: new URL(import.meta.url.endsWith('.ts') ? './generate.ts' : './generate.js', import.meta.url).href },
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  running = true;
  return new Promise<PlannerResult>((resolve, reject) => {
    let settled = false;
    const finish = async (result?: PlannerResult, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      running = false;
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => void finish({ ok: false, gaps: [{ code: 'no_solution', message: 'Generation exceeded 30 seconds. No draft was saved. Reduce the playing window or adjust the roster and try again.' }] }), DEADLINE_MS);
    worker.once('message', (result: PlannerResult) => void finish(result));
    worker.once('error', (error) => void finish(undefined, error));
    worker.once('exit', (code) => void finish(undefined, new Error(`Planner worker exited without a result (code ${code})`)));
  });
}
