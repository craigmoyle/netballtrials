import type { PlanSlot, PlannerPlayer, Position } from './types';

const POSITIONS: Position[] = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
type EventLabel = { name: string; eventDate: string; venue: string };

type SheetInput = {
  event: EventLabel;
  round: number;
  court: number;
  slots: PlanSlot[];
  players: PlannerPlayer[];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function renderSection(input: SheetInput): string {
  const players = new Map(input.players.map((player) => [player.registrationId, player]));
  const slots = new Map(input.slots.map((slot) => [`${slot.team}:${slot.position}`, slot]));
  const team = (teamId: 0 | 1) => POSITIONS.map((position) => {
    const slot = slots.get(`${teamId}:${position}`);
    const player = slot ? players.get(slot.registrationId) : undefined;
    if (!player) return `<tr><th scope="row">${position}</th><td></td><td></td></tr>`;
    const selected = [player.rank1, player.rank2, player.rank3].filter(Boolean);
    const marker = selected.includes(position) ? '' : ' <span class="selector-print__extra">*</span>';
    return `<tr><th scope="row">${position}</th><td>${player.bibNumber || ''}</td><td>${escapeHtml(player.name)}${marker}</td></tr>`;
  }).join('');

  return `<section class="sheet" data-round="${input.round}" data-court="${input.court}">
<header class="selector-print__header"><h1>${escapeHtml(input.event.name)}</h1><p>Round ${input.round} · Court ${input.court} · ${escapeHtml(input.event.venue)} · ${escapeHtml(input.event.eventDate)}</p></header>
<table><caption>Team 1</caption><thead><tr><th>Position</th><th>Bib</th><th>Player</th></tr></thead><tbody>${team(0)}</tbody></table>
<table><caption>Team 2</caption><thead><tr><th>Position</th><th>Bib</th><th>Player</th></tr></thead><tbody>${team(1)}</tbody></table>
<p class="selector-print__legend">* out of the player's selected positions</p>
</section>`;
}

export function renderSelectorSheets(input: {
  event: EventLabel;
  slots: PlanSlot[];
  players: PlannerPlayer[];
}): string {
  const rounds = [...new Set(input.slots.map((slot) => slot.round))].sort((a, b) => a - b);
  const courts = [...new Set(input.slots.map((slot) => slot.court))].sort((a, b) => a - b);
  const sections: string[] = [];
  for (const round of rounds) {
    for (const court of courts) {
      const slots = input.slots.filter((slot) => slot.round === round && slot.court === court);
      if (slots.length === 0) continue;
      sections.push(renderSection({ event: input.event, round, court, slots, players: input.players }));
    }
  }

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.event.name)} selector sheets</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
.selector-print { color: #111; font: 12px/1.3 system-ui, sans-serif; }
.selector-print .sheet { min-height: 180mm; break-inside: avoid; page-break-inside: avoid; }
.selector-print .sheet:not(:last-child) { break-after: page; page-break-after: always; }
.selector-print .selector-print__header { border-bottom: 2px solid #603259; margin-bottom: 8px; }
.selector-print .selector-print__header h1 { font-size: 18px; margin: 0; }
.selector-print .selector-print__header p { margin: 4px 0 12px; }
.selector-print table { border-collapse: collapse; width: 48%; float: left; margin-right: 2%; font-size: 12px; }
.selector-print th, .selector-print td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
.selector-print .selector-print__extra { color: #603259; font-weight: 700; }
.selector-print .selector-print__legend { clear: both; font-size: 11px; margin-top: 10px; }
</style></head>
<body><main class="selector-print">${sections.join('\n')}</main></body></html>`;
}

export function renderSelectorSheet(input: SheetInput): string {
  return renderSelectorSheets({ event: input.event, slots: input.slots, players: input.players });
}
