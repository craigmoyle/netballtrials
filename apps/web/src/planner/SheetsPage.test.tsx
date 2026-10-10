import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SheetsPage } from './SheetsPage';

describe('SheetsPage', () => {
  it('shows a print control and the sheet html', async () => {
    render(
      <SheetsPage
        client={{ getSheetsHtml: async () => '<section class="sheet">Round 1</section>' } as any}
        eventId="e1"
      />,
    );
    expect(await screen.findByRole('button', { name: /print/i })).toBeTruthy();
    expect(await screen.findByText('Round 1')).toBeTruthy();
  });
});
