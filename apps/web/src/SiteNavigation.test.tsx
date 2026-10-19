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

  it('groups lower-emphasis staff access links under a visible label', () => {
    render(<MemoryRouter><PublicAccessNav /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Staff and volunteer access' });

    expect(within(nav).getByText('Staff & volunteers')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Staff sign-in' })).toHaveAttribute('href', '/admin');
    expect(within(nav).getByRole('link', { name: 'Volunteer check-in' })).toHaveAttribute('href', '/check-in');
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
  });
});
