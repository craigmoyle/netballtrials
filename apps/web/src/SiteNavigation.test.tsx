import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClubLogoLink, PublicAccessNav } from './SiteNavigation';

describe('site navigation', () => {
  it('links the described Chisholm logo to the Trials homepage', () => {
    render(<MemoryRouter><ClubLogoLink /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('img', { name: 'Chisholm Netball logo' })).toBeInTheDocument();
  });

  it('offers the three sign-in choices with their existing destinations', () => {
    render(<MemoryRouter><PublicAccessNav /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Sign in options' });

    expect(within(nav).getByRole('link', { name: 'Chisholm Admin' })).toHaveAttribute('href', '/admin/login');
    expect(within(nav).getByRole('link', { name: 'Committee member' })).toHaveAttribute('href', '/check-in');
    expect(within(nav).getByRole('link', { name: 'Volunteer' })).toHaveAttribute('href', '/check-in');
  });
});
