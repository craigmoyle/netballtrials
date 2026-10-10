import { describe, it, expect } from 'vitest';
import { renderSelectorSheets } from '../../planner/sheets';
import { plannerInput } from '../helpers/planner';
import { generatePlan } from '../../planner/generate';

describe('renderSelectorSheets', () => {
  it('renders multiple ordered sheets in one landscape document with only inter-sheet breaks', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 2 });
    const result = generatePlan(input, 1);
    if (!result.ok) throw new Error('expected a plan');
    const html = renderSelectorSheets({
      event: { name: '15/U Ladies', eventDate: '2026-09-12', venue: 'SNC' },
      slots: result.plan.slots,
      players: input.players,
    });
    expect((html.match(/<!doctype html>/gi) ?? [])).toHaveLength(1);
    expect((html.match(/class="sheet"/g) ?? [])).toHaveLength(2);
    expect(html.indexOf('data-round="1"')).toBeLessThan(html.indexOf('data-round="2"'));
    expect(html).toContain('@page { size: A4 landscape');
    expect(html).toContain('.sheet:not(:last-child)');
    expect(html).not.toContain('.sheet { page-break-after: always; }');
  });

  it('escapes player and event data in printable HTML', () => {
    const input = plannerInput({ courts: 1, players: 14, rounds: 1 });
    const result = generatePlan(input, 1);
    if (!result.ok) throw new Error('expected a plan');
    const players = input.players.map((player, index) => index === 0
      ? { ...player, name: '<img src=x onerror=alert(1)>' }
      : player);
    const html = renderSelectorSheets({
      event: { name: '<script>bad()</script>', eventDate: '2026-09-12', venue: 'SNC' },
      slots: result.plan.slots,
      players,
    });
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });
});
