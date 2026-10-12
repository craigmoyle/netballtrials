import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BlankSheetPage } from './BlankSheetPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderBlank(client: Record<string, unknown>) {
  return render(<MemoryRouter><BlankSheetPage client={client as any} eventId="event-1" /></MemoryRouter>);
}

describe('BlankSheetPage', () => {
  it('loads the one-sheet preview from the blank endpoint and prints it', async () => {
    const html = '<main class="blank-sheet"><section class="sheet">Round: ________</section></main>';
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const getBlankSheetHtml = vi.fn().mockResolvedValue(html);
    const client = { getBlankSheetHtml };
    const view = renderBlank(client);

    expect(await screen.findByText('Round: ________')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Blank game sheet' })).toBeInTheDocument();
    expect(view.container.querySelectorAll('.sheet')).toHaveLength(1);
    expect(getBlankSheetHtml).toHaveBeenCalledWith('event-1');
    expect(screen.getByRole('link', { name: 'Back to selector sheets' })).toHaveAttribute('href', '/admin/events/event-1/sheets');
    fireEvent.click(screen.getByRole('button', { name: 'Print blank game sheet' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('provides a return link when the blank sheet cannot be loaded', async () => {
    renderBlank({ getBlankSheetHtml: vi.fn().mockRejectedValue(new Error('offline')) });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the blank game sheet/i);
    expect(screen.getByRole('link', { name: 'Back to selector sheets' })).toHaveAttribute('href', '/admin/events/event-1/sheets');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
