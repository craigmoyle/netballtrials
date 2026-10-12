import { COURT_POSITIONS } from './types';
import { escapeHtml } from './sheets';

type BlankSheetEvent = { name: string; eventDate: string; venue: string };

function renderTeam(teamName: 'Team A' | 'Team B'): string {
  const rows = COURT_POSITIONS.map((position) =>
    `<tr><th scope="row">${position}</th><td></td><td></td><td class="blank-sheet__rating"></td><td class="blank-sheet__notes"></td></tr>`,
  ).join('');
  return `<section class="blank-sheet__team"><header><h2>${teamName}</h2><p>${teamName} color: <span class="blank-sheet__line" aria-hidden="true"></span></p></header>
<table><caption>${teamName}</caption><thead><tr><th scope="col">Position</th><th scope="col">Number</th><th scope="col">Player</th><th scope="col">Rating</th><th scope="col">Notes/Feedback</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export function renderBlankGameSheet(event: BlankSheetEvent): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(event.name)} blank game sheet</title>
<style>
@page { size: A4 landscape; margin: 12mm; }
.blank-sheet { color: #111; font: 12px/1.3 system-ui, sans-serif; }
.blank-sheet .sheet { min-height: 180mm; break-inside: avoid; page-break-inside: avoid; }
.blank-sheet__header { margin-bottom: 5mm; padding-bottom: 3mm; border-bottom: 2px solid #511631; }
.blank-sheet__header h1 { margin: 0; font-size: 20px; }
.blank-sheet__header p { margin: 1mm 0; }
.blank-sheet__fields { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; margin-top: 3mm; }
.blank-sheet__line { display: inline-block; min-width: 45mm; min-height: 5mm; border-bottom: 1px solid #333; vertical-align: bottom; }
.blank-sheet__teams { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5mm; }
.blank-sheet__team { min-width: 0; }
.blank-sheet__team header { display: flex; align-items: center; justify-content: space-between; gap: 3mm; }
.blank-sheet__team h2 { margin: 0 0 2mm; color: #511631; font-size: 14px; }
.blank-sheet__team header p { margin: 0 0 2mm; }
.blank-sheet table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.blank-sheet caption { margin-bottom: 1mm; text-align: left; font-weight: 700; }
.blank-sheet th, .blank-sheet td { padding: 1.3mm 1.5mm; border: 1px solid #333; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.blank-sheet thead { background: #a9bfe1; }
.blank-sheet th:first-child { width: 20mm; }
.blank-sheet th:nth-child(2) { width: 19mm; }
.blank-sheet th:nth-child(3) { width: 35mm; }
.blank-sheet th:nth-child(4) { width: 18mm; }
.blank-sheet tbody th, .blank-sheet tbody td { height: 17mm; }
.blank-sheet .blank-sheet__rating { width: 20mm; }
.blank-sheet .blank-sheet__notes { width: 42mm; }
</style></head>
<body><main class="blank-sheet"><section class="sheet">
<header class="blank-sheet__header"><h1>${escapeHtml(event.name)}</h1><p>${escapeHtml(event.eventDate)} · ${escapeHtml(event.venue)}</p>
<div class="blank-sheet__fields"><div>Round: <span class="blank-sheet__line" aria-hidden="true"></span></div><div>Court: <span class="blank-sheet__line" aria-hidden="true"></span></div></div></header>
<div class="blank-sheet__teams">${renderTeam('Team A')}${renderTeam('Team B')}</div>
</section></main></body></html>`;
}
