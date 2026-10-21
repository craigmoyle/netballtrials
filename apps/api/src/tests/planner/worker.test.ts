import { expect, it, vi } from 'vitest';
import { runGeneration } from '../../planner/worker';
import { plannerInput } from '../helpers/planner';
import { verifyPlan } from '../../planner/verify';

it.each([false, true])('runs generation outside the event loop, rejects excess work, and releases the worker slot (extra positions: %s)', async (optInExtra) => {
  const input = plannerInput({ courts: 2, players: 28 });
  input.players.forEach((player) => { player.optInExtra = optInExtra; });
  const pending = runGeneration({ input, seed: 1 });
  const busy = await runGeneration({ input, seed: 2 });
  expect(busy).toMatchObject({ ok: false, gaps: [{ message: expect.stringMatching(/busy/i) }] });
  let loopRan = false;
  await new Promise<void>((resolve) => setImmediate(() => { loopRan = true; resolve(); }));
  const result = await pending;
  expect(loopRan).toBe(true);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(verifyPlan(input, result.plan)).toEqual([]);
  const frozenSlots = result.plan.slots.filter((slot) => slot.round === 1);
  const suffix = await runGeneration({ input, seed: 1, frozenSlots, fromRound: 2, minimumTotalRounds: result.plan.rounds });
  expect(suffix.ok).toBe(true);
  if (suffix.ok) expect(suffix.plan.slots.filter((slot) => slot.round === 1)).toEqual(frozenSlots);
});

it('terminates timed-out work without saving a result and admits the next job', async () => {
  const input = plannerInput({ courts: 1, players: 14 });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const pending = runGeneration({ input, seed: 1 });
    vi.advanceTimersByTime(30_000);
    expect(await pending).toMatchObject({ ok: false, gaps: [{ message: expect.stringMatching(/exceeded 30 seconds/) }] });
  } finally {
    vi.useRealTimers();
  }
  expect((await runGeneration({ input, seed: 1 })).ok).toBe(true);
});

it('releases capacity after a worker error', async () => {
  const input = plannerInput({ courts: 1, players: 14 });
  await expect(runGeneration({ input: { ...input, players: null as any }, seed: 1 })).rejects.toThrow();
  expect((await runGeneration({ input, seed: 1 })).ok).toBe(true);
});
