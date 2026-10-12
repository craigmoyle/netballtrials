import { describe, it, expect } from 'vitest';
import type { EventCourtColorDTO, RoundPlanPlayerDTO } from '@netball-trials/types';
import { renderSelectorSheets } from '../../planner/sheets';
import { plannerInput } from '../helpers/planner';
import { generatePlan } from '../../planner/generate';

function selectorInput(options: { courts?: number; rounds?: number; eventName?: string } = {}) {
  const courts = options.courts ?? 2;
  const planner = plannerInput({ courts, players: courts * 14, rounds: options.rounds ?? 2 });
  const generated = generatePlan(planner, 1);
  if (!generated.ok) throw new Error('expected a plan');

  const players: RoundPlanPlayerDTO[] = planner.players.map((player) => ({
    registrationId: player.registrationId,
    playerName: player.name,
    bibNumber: player.bibNumber,
    rank1Position: player.rank1,
    rank2Position: player.registrationId === 'p0' ? 'WA' : player.rank2,
    rank3Position: player.registrationId === 'p0' ? 'C' : player.rank3,
    optInExtraPositions: player.optInExtra,
    active: true,
  }));
  const colors: EventCourtColorDTO[] = [
    { court: 1, teamAColor: { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null }, teamBColor: { id: 'black', name: 'Black', hex: '#111111', archivedAt: null } },
    { court: 2, teamAColor: { id: 'grey', name: 'Grey', hex: '#777777', archivedAt: null }, teamBColor: { id: 'orange', name: 'Orange', hex: '#F28C28', archivedAt: null } },
  ].slice(0, courts);

  return {
    event: { name: options.eventName ?? '15/U Ladies', eventDate: '2026-09-12', venue: 'SNC' },
    slots: generated.plan.slots,
    players,
    courtColors: colors,
  };
}

describe('renderSelectorSheets', () => {
  it('renders one landscape sheet per round/court with both colored teams and writable player rows', () => {
    const html = renderSelectorSheets(selectorInput());

    expect((html.match(/<!doctype html>/gi) ?? [])).toHaveLength(1);
    expect((html.match(/class="sheet"/g) ?? [])).toHaveLength(4);
    expect(html.indexOf('data-round="1"')).toBeLessThan(html.indexOf('data-round="2"'));
    expect(html).toContain('@page { size: A4 landscape');
    expect(html).toMatch(/selector-print__teams\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    for (const header of ['Position', 'Number', 'Player', 'Choices', 'Rating', 'Notes/Feedback']) expect(html).toContain(header);
    for (const color of ['Team A', 'Team B', 'White', 'Black', 'Grey', 'Orange']) expect(html).toContain(color);
    expect((html.match(/class="selector-print__color-swatch"/g) ?? [])).toHaveLength(8);
    expect(html).toContain('background-color:#FFFFFF');
    expect(html).toContain('GS, WA, C');
    expect(html).toContain('.selector-print__notes { width: 56mm; }');
    expect(html).toContain('height: 17mm;');
    expect(html).toContain('.sheet:not(:last-child)');
    expect(html).not.toContain('.sheet { page-break-after: always; }');
  });

  it('escapes event, player and color names and rejects unsafe swatch values', () => {
    const input = selectorInput({ courts: 1, rounds: 1, eventName: '<script>bad()</script>' });
    input.players[0]!.playerName = '<img src=x onerror=alert(1)>';
    input.courtColors[0]!.teamAColor = {
      id: 'unsafe', name: '<svg onload=alert(1)>', hex: 'red;background:url(javascript:alert(1))', archivedAt: null,
    };
    const html = renderSelectorSheets(input);

    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;svg onload=alert(1)&gt;');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).not.toContain('background-color:red;');
  });
});
