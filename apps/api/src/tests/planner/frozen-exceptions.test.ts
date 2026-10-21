import { expect, it } from 'vitest';
import { verifyPlan } from '../../planner/verify';
import { frozenExceptions } from '../../planner/frozen-exceptions';
import { plannerInput } from '../helpers/planner';
import type { PlanSlot } from '../../planner/types';

function fixture() {
  const input = plannerInput({ courts: 1, players: 14, rounds: 2 });
  input.players.forEach((player) => { player.optInExtra = false; });
  const legal = (round: number): PlanSlot[] => input.players.map((player, i) => ({
    round, court: 1, position: player.rank1, team: i < 7 ? 0 : 1, registrationId: player.registrationId,
  }));
  const prefix = legal(1);
  [prefix[0].registrationId, prefix[1].registrationId] = [prefix[1].registrationId, prefix[0].registrationId];
  return {
    input: { ...input, frozenThroughRound: 1, approvedFrozenSlots: [prefix[0], prefix[1]] },
    plan: { rounds: 2, slots: [...prefix, ...legal(2)] },
  };
}

it('allows only exact approved frozen assignments, even for an inactive player', () => {
  const { input, plan } = fixture();
  expect(verifyPlan(input, plan)).toEqual([]);
  expect(verifyPlan({ ...input, approvedFrozenSlots: [] }, plan).filter((gap) => gap.message.includes('not opted in'))).toHaveLength(2);
  const invalid = structuredClone(plan);
  [invalid.slots[14].registrationId, invalid.slots[15].registrationId] = [invalid.slots[15].registrationId, invalid.slots[14].registrationId];
  expect(verifyPlan(input, invalid).filter((gap) => gap.message.includes('not opted in'))).toHaveLength(2);
  const inactive = { ...input, inactiveRegistrationIds: ['p0'], approvedFrozenSlots: [] };
  expect(verifyPlan(inactive, plan).filter((gap) => gap.message.includes('not opted in'))).toHaveLength(2);
});

it.each(['missing', 'duplicate', 'unknown', 'team'] as const)('still rejects %s structural corruption in an approved frozen prefix', (mutation) => {
  const { input, plan } = fixture();
  if (mutation === 'missing') plan.slots.shift();
  if (mutation === 'duplicate') plan.slots[1] = { ...plan.slots[1], registrationId: plan.slots[0].registrationId };
  if (mutation === 'unknown') plan.slots[0] = { ...plan.slots[0], registrationId: 'unknown' };
  if (mutation === 'team') plan.slots[0] = { ...plan.slots[0], team: 3 as 0 };
  expect(verifyPlan(input, plan).length).toBeGreaterThan(0);
});

it('does not broaden a partial, mismatched, or unrelated approval', () => {
  const { input, plan } = fixture();
  const slot = input.approvedFrozenSlots[0];
  for (const warning of [
    { code: 'no_solution', message: 'Not an approval', detail: { ...slot } },
    { code: 'position_preference_warning', message: 'Different round', detail: { ...slot, round: 2 } },
    { code: 'position_preference_warning', message: 'Missing court', detail: { registrationId: slot.registrationId, position: slot.position, round: 1 } },
  ]) {
    expect(frozenExceptions({ slots: plan.slots, validationWarnings: [warning] }, plan.slots, 1)).toEqual({ slots: [], warnings: [] });
  }
  const changed = structuredClone(plan.slots);
  changed[0].team = 1;
  expect(frozenExceptions({ slots: plan.slots, validationWarnings: [{ code: 'position_preference_warning', message: 'Approved', detail: { ...slot } }] }, changed, 1).slots).toEqual([]);
});
