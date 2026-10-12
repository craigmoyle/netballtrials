import { describe, it, expect } from 'vitest';
import { renderBlankGameSheet } from '../../planner/blank-sheet';

const positions = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

describe('renderBlankGameSheet', () => {
  it('renders one writable A4 landscape sheet with blank game fields and both teams', () => {
    const html = renderBlankGameSheet({ name: '15/U Ladies', eventDate: '2026-09-12', venue: 'SNC' });

    expect((html.match(/class="sheet"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('@page { size: A4 landscape');
    expect(html).toContain('15/U Ladies');
    expect(html).toContain('2026-09-12');
    expect(html).toContain('SNC');
    expect(html).toMatch(/Round: <span class="blank-sheet__line"/);
    expect(html).toMatch(/Court: <span class="blank-sheet__line"/);
    expect(html).toMatch(/Team A color: <span class="blank-sheet__line"/);
    expect(html).toMatch(/Team B color: <span class="blank-sheet__line"/);
    expect(html).not.toMatch(/Round [1-9]|Court [1-9]|White|Black|Grey|Orange/);
    expect(html).toContain('Team A');
    expect(html).toContain('Team B');
    for (const header of ['Position', 'Number', 'Player', 'Rating', 'Notes/Feedback']) expect(html).toContain(header);
    for (const position of positions) expect((html.match(new RegExp(`<th scope="row">${position}</th>`, 'g')) ?? [])).toHaveLength(2);
    expect((html.match(/class="blank-sheet__rating"/g) ?? [])).toHaveLength(14);
    expect((html.match(/class="blank-sheet__notes"/g) ?? [])).toHaveLength(14);
    expect(html).toContain('.blank-sheet__notes { width: 44mm; }');
    expect(html).toContain('height: 17mm;');
    expect(html).not.toContain('data-round="');
    expect(html).not.toContain('Color not set');
  });

  it('escapes event metadata in the standalone document', () => {
    const html = renderBlankGameSheet({ name: '<script>bad()</script>', eventDate: '2026-09-12', venue: '<b>SNC</b>' });
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;SNC&lt;/b&gt;');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).not.toContain('<b>SNC</b>');
  });
});
