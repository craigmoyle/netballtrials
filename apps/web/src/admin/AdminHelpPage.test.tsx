import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminHelpPage } from './AdminHelpPage';

describe('AdminHelpPage', () => {
  it('covers core Admin workflows and links directly to the relevant screens', () => {
    render(<MemoryRouter><AdminHelpPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Admin help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Events and registrations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planning and printing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Communications' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Settings and staff access' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View registration totals' })).toHaveAttribute('href', '/admin/registrations');
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/admin/settings');
  });
});
