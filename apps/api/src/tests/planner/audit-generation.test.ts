import { describe, expect, it } from 'vitest';
import { generatePlan, generatePlanFromPrefix } from '../../planner/generate';
import { verifyPlan } from '../../planner/verify';
import { repeatOpponentPairs } from '../../planner/fairness';
import { COURT_POSITIONS, type PlannerInput, type PlanSlot } from '../../planner/types';

export function fixedInput(count = 60, courts = 4, windowMinutes = 48): PlannerInput {
  return {
    courts, rounds: Math.ceil(count / 14), playMinutes: 8, changeoverMinutes: 2, windowMinutes,
    rank1Min: 1, rank2Min: 0, rank3Min: 0,
    players: Array.from({ length: count }, (_, i) => ({
      registrationId: `p${String(i).padStart(3, '0')}`, name: `Player ${i}`, bibNumber: i + 1,
      rank1: COURT_POSITIONS[i % 7], rank2: null, rank3: null, optInExtra: false,
    })),
  };
}

describe('multi-step bench repair', () => {
  it('has a verified five-round witness for 60 fixed-position players on four courts', () => {
    const input = fixedInput();
    const slots: PlanSlot[] = [];
    for (const position of COURT_POSITIONS) {
      const players = input.players.filter((player) => player.rank1 === position);
      for (let round = 1; round <= 5; round++) {
        players.forEach((player, k) => {
          const seat = (k + 2 * (round - 1)) % players.length;
          if (seat !== 8) slots.push({ round, court: Math.floor(seat / 2) + 1, position, team: (seat % 2) as 0 | 1, registrationId: player.registrationId });
        });
      }
    }
    expect(verifyPlan(input, { rounds: 5, slots })).toEqual([]);
  });

  it.each([1, 4, 19, 42])('finds a verified five-round plan with seed %i, independent of roster order', (seed) => {
    const input = fixedInput();
    const result = generatePlan(input, seed);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.plan.rounds).toBe(5);
      expect(verifyPlan(input, result.plan)).toEqual([]);
    }
    expect(generatePlan({ ...input, players: [...input.players].reverse() }, seed)).toEqual(result);
  });

  it('repairs a mixed roster without the fixed-position rotation shortcut', () => {
    const input = fixedInput(60, 4, 150);
    input.players.slice(0, 4).forEach((player) => { player.optInExtra = true; });
    const result = generatePlan(input, 1);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(verifyPlan(input, result.plan)).toEqual([]);
  });

  it.each([[56, 38], [60, 48]])('regenerates the %i-player rotation within its %i-minute window without changing any frozen slots', (count, windowMinutes) => {
    const input = fixedInput(count, 4, windowMinutes);
    const root = generatePlan(input, 1);
    if (!root.ok) throw new Error(JSON.stringify(root));
    expect(root.plan.rounds).toBe(count === 56 ? 4 : 5);
    for (const fromRound of [2, 3]) {
      const prefix = root.plan.slots.filter((slot) => slot.round < fromRound).reverse();
      for (const seed of [1, 42]) {
        const result = generatePlanFromPrefix(input, seed, prefix, fromRound, root.plan.rounds);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) continue;
        expect(result.plan.rounds).toBe(root.plan.rounds);
        expect(result.plan.slots.filter((slot) => slot.round < fromRound)).toEqual(prefix);
        expect(verifyPlan({ ...input, frozenThroughRound: fromRound - 1 }, result.plan)).toEqual([]);
      }
    }
  });

  it.each(['empty', 'missing slot', 'missing round', 'extra slot', 'duplicate slot', 'changed slot'])('does not replace a forged frozen prefix (%s) with a new root rotation', (change) => {
    const input = fixedInput(56, 4, 38);
    const root = generatePlan(input, 1);
    if (!root.ok) throw new Error(JSON.stringify(root));
    let prefix = root.plan.slots.filter((slot) => slot.round < 3).map((slot) => ({ ...slot }));
    if (change === 'empty') prefix = [];
    if (change === 'missing slot') prefix.pop();
    if (change === 'missing round') prefix = prefix.filter((slot) => slot.round === 2);
    if (change === 'extra slot') prefix.push({ ...prefix[0] });
    if (change === 'duplicate slot') prefix[1] = { ...prefix[0] };
    if (change === 'changed slot') prefix[0].team = prefix[0].team === 0 ? 1 : 0;
    expect(generatePlanFromPrefix(input, 42, prefix, 3, root.plan.rounds).ok).toBe(false);
  });

  it('does not overwrite a legal frozen prefix that differs from the rotation', () => {
    const input = fixedInput(56, 4, 38);
    const root = generatePlan(input, 1);
    if (!root.ok) throw new Error(JSON.stringify(root));
    const prefix = root.plan.slots.filter((slot) => slot.round === 1).map((slot) => ({ ...slot }));
    const pair = prefix.filter((slot) => slot.court === 1 && slot.position === 'GS');
    [pair[0].registrationId, pair[1].registrationId] = [pair[1].registrationId, pair[0].registrationId];
    expect(verifyPlan(input, { ...root.plan, slots: [...prefix, ...root.plan.slots.filter((slot) => slot.round > 1)] })).toEqual([]);
    const result = generatePlanFromPrefix(input, 42, prefix, 2, root.plan.rounds);
    if (result.ok) {
      expect(result.plan.slots.filter((slot) => slot.round === 1)).toEqual(prefix);
      expect(verifyPlan({ ...input, frozenThroughRound: 1 }, result.plan)).toEqual([]);
    }
  });

  it('varies opponents for every player in an exactly filled 84-player, six-court rotation', () => {
    const input = fixedInput(84, 6, 58);
    const result = generatePlan(input, 1);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.plan.rounds).toBe(6);
    expect(verifyPlan(input, result.plan)).toEqual([]);
    expect(repeatOpponentPairs(result.plan)).toBeLessThanOrEqual(1220);
    for (const player of input.players) {
      const opponents = new Set<string>();
      for (const game of result.plan.slots.filter((slot) => slot.registrationId === player.registrationId)) {
        for (const other of result.plan.slots) {
          if (other.round === game.round && other.court === game.court && other.team !== game.team) opponents.add(other.registrationId);
        }
      }
      expect(opponents.size).toBeGreaterThan(7);
    }
  });

  it('rejects overlapping eligibility that cannot fill both positions, even with a long window', () => {
    const input = fixedInput(14, 1, 150);
    input.rank1Min = 0;
    input.players.forEach((player, index) => {
      player.rank1 = index < 3 ? 'GS' : COURT_POSITIONS[2 + (index - 3) % 5];
      player.rank2 = index < 3 ? 'GA' : null;
    });
    for (const seed of [1, 4, 19]) {
      const result = generatePlan(input, seed);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.gaps.some((gap) => gap.message.includes('legal positions'))).toBe(true);
    }
  });

  it('finds a feasible mixed-position plan for a typical 100-player, six-court event', () => {
    let state = 1;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const input: PlannerInput = {
      courts: 6, rounds: 8, playMinutes: 8, changeoverMinutes: 2, windowMinutes: 150,
      rank1Min: 1, rank2Min: 1, rank3Min: 0,
      players: Array.from({ length: 100 }, (_, index) => {
        const first = Math.floor(random() * 7);
        const second = (first + 1 + Math.floor(random() * 6)) % 7;
        return {
          registrationId: `p${String(index).padStart(3, '0')}`, name: `Player ${index}`, bibNumber: index + 1,
          rank1: COURT_POSITIONS[first], rank2: random() < 0.6 ? COURT_POSITIONS[second] : null,
          rank3: null, optInExtra: random() < 0.1,
        };
      }),
    };
    const result = generatePlan(input, 1);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(verifyPlan(input, result.plan)).toEqual([]);
  });

  it('still rejects an actually impossible fixed-position roster', () => {
    const input = fixedInput();
    input.players[6].rank1 = 'GS'; // Seven GK players cannot fill eight GK places.
    const result = generatePlan(input, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gaps.some((gap) => gap.message.includes('only 7 players can play GK'))).toBe(true);
  });
});
