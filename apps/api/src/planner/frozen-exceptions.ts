import type { Prisma } from '@prisma/client';
import type { PlannerGap, PlanSlot } from './types';

export function slotKey(slot: { round: number; court: number; position: string; team: number; registrationId: string }): string {
  return JSON.stringify([slot.round, slot.court, slot.position, slot.team, slot.registrationId]);
}

// Only the published source can authorize an exception; a draft's warnings are not authority.
export function frozenExceptions(
  source: { slots: Array<Omit<PlanSlot, 'team'> & { team: number }>; validationWarnings: Prisma.JsonValue },
  frozenSlots: PlanSlot[],
  frozenThroughRound: number,
): { slots: PlanSlot[]; warnings: PlannerGap[] } {
  const sourceKeys = new Set(source.slots.map(slotKey));
  const frozen = frozenSlots.filter((slot) => slot.round <= frozenThroughRound && sourceKeys.has(slotKey(slot)))
    .map(({ round, court, position, team, registrationId }) => ({ round, court, position, team, registrationId }));
  const warnings: PlannerGap[] = [];
  const approved: PlanSlot[] = [];
  for (const value of Array.isArray(source.validationWarnings) ? source.validationWarnings : []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.code !== 'position_preference_warning' || typeof value.message !== 'string') continue;
    const detail = value.detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue;
    // Older manual revisions recorded only player + position. Resolve those approvals
    // against that immutable published revision, then persist exact slot coordinates.
    const legacy = detail.round === undefined && detail.court === undefined && detail.team === undefined;
    for (const slot of frozen) {
      if (slot.position !== detail.position || slot.registrationId !== detail.registrationId ||
        (!legacy && (slot.round !== detail.round || slot.court !== detail.court || slot.team !== detail.team)) ||
        approved.some((previous) => slotKey(previous) === slotKey(slot))) continue;
      approved.push(slot);
      warnings.push({ code: 'position_preference_warning', message: value.message, detail: { ...slot } });
    }
  }
  return { slots: approved, warnings };
}
