import type { PlanSlot, PlannerPlayer, Position } from './types';

const POSITIONS: Position[] = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export function renderSelectorSheet(input: {
  event: { name: string; eventDate: string; venue: string };
  round: number;
  court: number;
  slots: PlanSlot[];
  players: PlannerPlayer[];
}): string {
  const playersById = new Map(input.players.map((player) => [player.registrationId, player]));

  const renderTeam = (team: number) =>
    POSITIONS.map((position) => {
      const slot = input.slots.find((entry) => entry.team === team && entry.position === position);
      const player = slot ? playersById.get(slot.registrationId) : undefined;
      if (!player) {
        return `<tr><th scope="row">${position}</th><td></td><td></td></tr>`;
      }
      const selected = [player.rank1, player.rank2, player.rank3].filter(
        (value): value is Position => Boolean(value),
      );
      const marker = selected.includes(position) ? '' : ' <span class="extra">*</span>';
      return `<tr><th scope="row">${position}</th><td>${player.bibNumber}</td><td>${escapeHtml(player.name)}${marker}</td></tr>`;
    }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.event.name)} — round ${input.round}, court ${input.court}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: system-ui, sans-serif; color: #111; }
  header { border-bottom: 2px solid #603259; margin-bottom: 8px; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 14px; margin: 4px 0 12px; }
  .sheet { page-break-after: always; }
  table { border-collapse: collapse; width: 48%; float: left; margin-right: 2%; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
  .extra { color: #603259; font-weight: 700; }
  .legend { clear: both; font-size: 11px; margin-top: 10px; }
</style>
</head>
<body>
<section class="sheet">
  <header>
    <h1>${escapeHtml(input.event.name)}</h1>
    <h2>Round ${input.round} — Court ${input.court} — ${escapeHtml(input.event.venue)} — ${escapeHtml(input.event.eventDate)}</h2>
  </header>
  <table>
    <caption>Team 1</caption>
    <thead><tr><th>Position</th><th>Bib</th><th>Player</th></tr></thead>
    <tbody>${renderTeam(0)}</tbody>
  </table>
  <table>
    <caption>Team 2</caption>
    <thead><tr><th>Position</th><th>Bib</th><th>Player</th></tr></thead>
    <tbody>${renderTeam(1)}</tbody>
  </table>
  <p class="legend">* out of the player's selected positions</p>
</section>
</body>
</html>`;
}
