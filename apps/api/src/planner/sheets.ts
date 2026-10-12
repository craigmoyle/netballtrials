import type { BibColorDTO, EventCourtColorDTO, RoundPlanPlayerDTO } from '@netball-trials/types';
import { COURT_POSITIONS, type PlanSlot } from './types';

type EventLabel = { name: string; eventDate: string; venue: string };
type SelectorSheetsInput = {
  event: EventLabel;
  slots: PlanSlot[];
  players: RoundPlanPlayerDTO[];
  courtColors: EventCourtColorDTO[];
};
type SheetInput = {
  event: EventLabel;
  round: number;
  court: number;
  slots: PlanSlot[];
  players: RoundPlanPlayerDTO[];
  courtColors: EventCourtColorDTO[];
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function colorFor(colors: EventCourtColorDTO[], court: number, team: 0 | 1): BibColorDTO | null {
  const pair = colors.find((item) => item.court === court);
  return team === 0 ? pair?.teamAColor ?? null : pair?.teamBColor ?? null;
}

function renderSwatch(color: BibColorDTO | null): string {
  const hex = color?.hex && /^#[\da-f]{6}$/iu.test(color.hex) ? color.hex : null;
  return `<span class="selector-print__color-swatch" aria-hidden="true"${hex ? ` style="background-color:${hex}"` : ''}></span>`;
}

function renderTeam(input: SheetInput, team: 0 | 1, players: Map<string, RoundPlanPlayerDTO>): string {
  const teamName = team === 0 ? 'Team A' : 'Team B';
  const color = colorFor(input.courtColors, input.court, team);
  const colorName = color?.name ?? 'Color not assigned';
  const slots = new Map(input.slots.filter((slot) => slot.team === team).map((slot) => [slot.position, slot]));
  const rows = COURT_POSITIONS.map((position) => {
    const slot = slots.get(position);
    const player = slot ? players.get(slot.registrationId) : undefined;
    if (!player) return `<tr><th scope="row">${position}</th><td></td><td></td><td></td><td class="selector-print__rating"></td><td class="selector-print__notes"></td></tr>`;

    const choices = [player.rank1Position, player.rank2Position, player.rank3Position].filter(Boolean);
    const marker = choices.includes(position) ? '' : ' <span class="selector-print__extra">*</span>';
    return `<tr><th scope="row">${position}</th><td>${player.bibNumber ?? ''}</td><td>${escapeHtml(player.playerName)}${marker}</td><td>${escapeHtml(choices.join(', '))}</td><td class="selector-print__rating"></td><td class="selector-print__notes"></td></tr>`;
  }).join('');

  return `<section class="selector-print__team">
<header><h2>${teamName}</h2><p class="selector-print__team-color">${renderSwatch(color)}<span>${escapeHtml(colorName)}</span></p></header>
<table><caption>${teamName} — ${escapeHtml(colorName)}</caption><thead><tr><th scope="col">Position</th><th scope="col">Number</th><th scope="col">Player</th><th scope="col">Choices</th><th scope="col">Rating</th><th scope="col">Notes/Feedback</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function renderSection(input: SheetInput): string {
  const players = new Map(input.players.map((player) => [player.registrationId, player]));
  const slots = input.slots.filter((slot) => slot.round === input.round && slot.court === input.court);
  return `<section class="sheet" data-round="${input.round}" data-court="${input.court}">
<header class="selector-print__header"><h1>${escapeHtml(input.event.name)}</h1><p>${escapeHtml(input.event.eventDate)} · ${escapeHtml(input.event.venue)} · Round ${input.round} · Court ${input.court}</p></header>
<div class="selector-print__teams">${renderTeam({ ...input, slots }, 0, players)}${renderTeam({ ...input, slots }, 1, players)}</div>
<p class="selector-print__legend">* out of the player's selected positions</p>
</section>`;
}

export function renderSelectorSheets(input: SelectorSheetsInput): string {
  const players = input.players;
  const courtColors = input.courtColors;
  const rounds = [...new Set(input.slots.map((slot) => slot.round))].sort((a, b) => a - b);
  const courts = [...new Set(input.slots.map((slot) => slot.court))].sort((a, b) => a - b);
  const sections: string[] = [];
  for (const round of rounds) {
    for (const court of courts) {
      if (input.slots.some((slot) => slot.round === round && slot.court === court)) {
        sections.push(renderSection({ event: input.event, slots: input.slots, players, courtColors, round, court }));
      }
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
.selector-print__header { margin-bottom: 5mm; border-bottom: 2px solid #511631; }
.selector-print__header h1 { margin: 0; font-size: 18px; }
.selector-print__header p { margin: 1mm 0 3mm; }
.selector-print__teams { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8mm; }
.selector-print__team { min-width: 0; }
.selector-print__team header { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }
.selector-print__team h2 { margin: 0 0 2mm; color: #511631; font-size: 14px; }
.selector-print__team-color { display: flex; align-items: center; gap: 2mm; margin: 0 0 2mm; font-weight: 700; }
.selector-print__color-swatch { display: inline-block; width: 5mm; height: 5mm; border: 1px solid #222; }
.selector-print table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
.selector-print caption { margin-bottom: 1mm; text-align: left; font-weight: 700; }
.selector-print th, .selector-print td { padding: 1.3mm 1.5mm; border: 1px solid #333; text-align: left; vertical-align: top; }
.selector-print thead { background: #a9bfe1; }
.selector-print th, .selector-print td { overflow-wrap: anywhere; }
.selector-print th:first-child { width: 9mm; }
.selector-print th:nth-child(2) { width: 12mm; }
.selector-print th:nth-child(3) { width: 25mm; }
.selector-print th:nth-child(4) { width: 16mm; }
.selector-print th:nth-child(5) { width: 14mm; }
.selector-print tbody th, .selector-print tbody td { height: 17mm; }
.selector-print .selector-print__rating { width: 14mm; }
.selector-print .selector-print__notes { width: 56mm; }
.selector-print .selector-print__extra { color: #511631; font-weight: 700; }
.selector-print__legend { clear: both; margin: 2mm 0 0; font-size: 9px; }
</style></head>
<body><main class="selector-print">${sections.join('\n')}</main></body></html>`;
}
