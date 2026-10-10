import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SheetsPage } from './SheetsPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderSheets(client: Record<string, unknown>) {
  return render(<MemoryRouter><SheetsPage client={client as any} eventId="e1" /></MemoryRouter>);
}

describe('SheetsPage', () => {
  it('denies draft printing and explains that publication is required', async () => {
    const getSheetsHtml = vi.fn();
    renderSheets({ getPublishedPlan: vi.fn().mockResolvedValue(null), getSheetsHtml });
    expect(await screen.findByRole('alert')).toHaveTextContent(/publish a plan before printing/i);
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument();
    expect(getSheetsHtml).not.toHaveBeenCalled();
  });

  it('prints a published revision and preserves its sheet markup', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const getSheetsHtml = vi.fn().mockResolvedValue('<main class="selector-print"><section class="sheet">Round 1 Court 1</section></main>');
    renderSheets({ getPublishedPlan: vi.fn().mockResolvedValue({ id: 'published-2', status: 'PUBLISHED' }), getSheetsHtml });
    expect(await screen.findByText('Round 1 Court 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print selector sheets/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /print selector sheets/i }));
    expect(print).toHaveBeenCalledOnce();
    expect(getSheetsHtml).toHaveBeenCalledWith('e1');
  });

  it('shows a recoverable error when published sheet loading fails', async () => {
    const getSheetsHtml = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('<section class="sheet">Round 2</section>');
    renderSheets({ getPublishedPlan: vi.fn().mockResolvedValue({ id: 'published-2', status: 'PUBLISHED' }), getSheetsHtml });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load selector sheets/i);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Round 2')).toBeInTheDocument();
  });
});
