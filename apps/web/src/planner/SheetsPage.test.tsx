import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../api/client';
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
    expect(screen.getByRole('link', { name: 'Download Blank Sheet' })).toHaveAttribute('href', '/admin/events/e1/sheets/blank');
    expect(getSheetsHtml).not.toHaveBeenCalled();
  });

  it('explains unassigned court colors and links back to event settings', async () => {
    const client = {
      getPublishedPlan: vi.fn().mockResolvedValue({ id: 'published-2', status: 'PUBLISHED' }),
      getSheetsHtml: vi.fn().mockRejectedValue(new ApiError(409, 'court_colors_unassigned')),
    };
    renderSheets(client);

    expect(await screen.findByRole('alert')).toHaveTextContent(/team a and team b colors.*every court/i);
    expect(screen.getByRole('link', { name: /event settings and court colors/i })).toHaveAttribute('href', '/admin/events/e1');
    expect(screen.getByRole('link', { name: 'Download Blank Sheet' })).toHaveAttribute('href', '/admin/events/e1/sheets/blank');
  });

  it('prints a published revision and preserves its sheet markup', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const getSheetsHtml = vi.fn().mockResolvedValue('<main class="selector-print"><section class="sheet">Round 1 Court 1</section></main>');
    renderSheets({ getPublishedPlan: vi.fn().mockResolvedValue({ id: 'published-2', status: 'PUBLISHED' }), getSheetsHtml });
    expect(await screen.findByText('Round 1 Court 1')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selector sheet preview' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /print selector sheets/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download Blank Sheet' })).toHaveAttribute('href', '/admin/events/e1/sheets/blank');
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
