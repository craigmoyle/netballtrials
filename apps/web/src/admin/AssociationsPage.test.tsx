import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AssociationsPage } from './AssociationsPage';

afterEach(cleanup);

const association = (id: string, name: string, active: boolean) => ({
  id, name, active, primaryContactName: null, primaryContactEmail: null,
});

describe('AssociationsPage', () => {
  it('creates associations with a primary contact and allows activation changes', async () => {
    const listAssociations = vi.fn().mockResolvedValue([association('mena', 'MENA', true), association('old', 'Old Club', false)]);
    const createAssociation = vi.fn().mockResolvedValue({ ...association('new', 'North Club', true), primaryContactName: 'Morgan Contact', primaryContactEmail: 'morgan@example.test' });
    const setAssociationActive = vi.fn().mockResolvedValue(association('old', 'Old Club', true));
    const updateAssociation = vi.fn();
    render(<MemoryRouter><AssociationsPage client={{ listAssociations, createAssociation, updateAssociation, setAssociationActive } as any} /></MemoryRouter>);
    expect(await screen.findByText('MENA — Active')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Association name'), { target: { value: 'North Club' } });
    fireEvent.change(screen.getByLabelText('Primary contact name (optional)'), { target: { value: 'Morgan Contact' } });
    fireEvent.change(screen.getByLabelText('Primary contact email (optional)'), { target: { value: 'morgan@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add association' }));
    await waitFor(() => expect(createAssociation).toHaveBeenCalledWith({
      name: 'North Club', primaryContactName: 'Morgan Contact', primaryContactEmail: 'morgan@example.test',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Activate Old Club' }));
    await waitFor(() => expect(setAssociationActive).toHaveBeenCalledWith('old', true));
  });

  it('updates an existing association contact without changing its active state', async () => {
    const listAssociations = vi.fn().mockResolvedValue([association('mena', 'MENA', true)]);
    const updateAssociation = vi.fn().mockResolvedValue({
      id: 'mena', name: 'MENA', active: true, primaryContactName: 'Taylor Contact', primaryContactEmail: 'taylor@example.test',
    });
    render(<MemoryRouter><AssociationsPage client={{ listAssociations, updateAssociation, setAssociationActive: vi.fn() } as any} /></MemoryRouter>);
    await screen.findByText('MENA — Active');
    fireEvent.change(screen.getByLabelText('Primary contact name'), { target: { value: 'Taylor Contact' } });
    fireEvent.change(screen.getByLabelText('Primary contact email'), { target: { value: 'taylor@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    await waitFor(() => expect(updateAssociation).toHaveBeenCalledWith('mena', {
      primaryContactName: 'Taylor Contact', primaryContactEmail: 'taylor@example.test',
    }));
    expect(await screen.findByText(/Primary contact saved for MENA/)).toBeInTheDocument();
  });
});
