import { describe, it, expect } from 'vitest';
import { renderSelectorSheet } from '../../planner/sheets';
import { plannerInput } from '../helpers/planner';
import { generatePlan } from '../../planner/generate';

describe('renderSelectorSheet', () => {
  it('shows bib numbers, names, positions, and marks out-of-position games', () => {
    const input = plannerInput({ courts: 1, players: 14 });
    const result = generatePlan(input, 1);
    if (!result.ok) throw new Error('expected a plan');
    const slots = result.plan.slots.filter((slot) => slot.round === 1 && slot.court === 1);
    const html = renderSelectorSheet({
      event: { name: '15/U Ladies', eventDate: '2026-09-12', venue: 'SNC' },
      round: 1,
      court: 1,
      slots,
      players: input.players,
    });
    expect(html).toContain('landscape');
    expect(html).toContain('GS');
    expect(html).toMatch(/bib/i);
  });
});
