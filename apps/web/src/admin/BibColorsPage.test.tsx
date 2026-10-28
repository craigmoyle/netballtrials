import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BibColorsPage } from './BibColorsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const colors = [
  { id: 'white', name: 'White', hex: '#FFFFFF', archivedAt: null },
  { id: 'black', name: 'Black', hex: '#111111', archivedAt: null },
];

function renderCatalog(client: Record<string, unknown>) {
  return render(<BibColorsPage client={client as any} />);
}

describe('BibColorsPage', () => {
  it('shows swatches and adds a reusable catalog color', async () => {
    const createBibColor = vi.fn().mockResolvedValue({ id: 'teal', name: 'Test Teal', hex: '#12AB34', archivedAt: null });
    renderCatalog({ listBibColors: vi.fn().mockResolvedValue(colors), createBibColor });

    expect(await screen.findByRole('heading', { name: 'Bib colors' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Club bib colors' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('White')).toBeInTheDocument();
    expect(screen.getByText('#FFFFFF')).toBeInTheDocument();
    expect(screen.getByLabelText('White color swatch')).toHaveStyle({ backgroundColor: '#FFFFFF' });
    fireEvent.change(screen.getByLabelText('Color name'), { target: { value: ' Test Teal ' } });
    fireEvent.change(screen.getByLabelText('Color hex'), { target: { value: '#12AB34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add color' }));

    expect(createBibColor).toHaveBeenCalledWith({ name: ' Test Teal ', hex: '#12AB34' });
    expect(await screen.findByText('Test Teal')).toBeInTheDocument();
  });

  it('edits and archives a catalog entry without deleting its row', async () => {
    const updateBibColor = vi.fn().mockResolvedValue({ ...colors[0], name: 'Snow', hex: '#FDFDFD' });
    const archiveBibColor = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    renderCatalog({
      listBibColors: vi.fn().mockResolvedValue(colors),
      updateBibColor,
      archiveBibColor,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit White' }));
    fireEvent.change(screen.getByLabelText('Color name for White'), { target: { value: 'Snow' } });
    fireEvent.change(screen.getByLabelText('Color hex for White'), { target: { value: '#FDFDFD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save White' }));
    await waitFor(() => expect(updateBibColor).toHaveBeenCalledWith('white', { name: 'Snow', hex: '#FDFDFD' }));
    expect(await screen.findByText('Snow')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive Snow' }));
    await waitFor(() => expect(archiveBibColor).toHaveBeenCalledWith('white'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(/archived/i);
  });
});
