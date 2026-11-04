import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RouteLoadError } from './RouteLoadError';

afterEach(cleanup);

describe('RouteLoadError', () => {
  it('explains the failure and offers a reload or Events route', () => {
    render(<MemoryRouter><RouteLoadError /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'This page couldn’t load' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Events' })).toHaveAttribute('href', '/admin/events');
  });
});
