import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssociationsPage } from './AssociationsPage';

afterEach(cleanup);

describe('AssociationsPage', () => {
  it('creates associations and allows an administrator to activate or deactivate them', async () => {
    const listAssociations = vi.fn().mockResolvedValue([
      { id: 'mena', name: 'MENA', active: true },
      { id: 'old', name: 'Old Club', active: false },
    ]);
    const createAssociation = vi.fn().mockResolvedValue({ id: 'new', name: 'North Club', active: true });
    const setAssociationActive = vi.fn().mockResolvedValue({ id: 'old', name: 'Old Club', active: true });
    render(<MemoryRouter><AssociationsPage client={{ listAssociations, createAssociation, setAssociationActive } as any} /></MemoryRouter>);
    expect(await screen.findByText('MENA')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/new association name/i), { target: { value: 'North Club' } });
    fireEvent.click(screen.getByRole('button', { name: /add association/i }));
    await waitFor(() => expect(createAssociation).toHaveBeenCalledWith('North Club'));
    fireEvent.click(screen.getByRole('button', { name: /activate old club/i }));
    await waitFor(() => expect(setAssociationActive).toHaveBeenCalledWith('old', true));
  });
});
