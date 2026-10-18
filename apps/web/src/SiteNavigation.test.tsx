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

  it('offers one Admin entry and one volunteer check-in entry', () => {
    render(<MemoryRouter><PublicAccessNav /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Access options' });

    expect(within(nav).getByRole('link', { name: 'Chisholm Admin' })).toHaveAttribute('href', '/admin');
    expect(within(nav).getByRole('link', { name: 'Volunteer check-in' })).toHaveAttribute('href', '/check-in');
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
  });
});
