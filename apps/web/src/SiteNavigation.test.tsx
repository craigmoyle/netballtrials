import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ClubLogoLink, PublicAccessNav, PublicSiteHeader } from './SiteNavigation';

describe('site navigation', () => {
  it('links the described Chisholm logo to the Trials homepage', () => {
    render(<MemoryRouter><ClubLogoLink /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Trials home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('img', { name: 'Chisholm Netball logo' })).toBeInTheDocument();
  });

  it('offers a skip link before the repeated public header', () => {
    const { container, unmount } = render(<MemoryRouter><PublicSiteHeader /></MemoryRouter>);
    const skipLink = within(container).getByRole('link', { name: 'Skip to main content' });

    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(within(container).getAllByRole('link')[0]).toBe(skipLink);
    unmount();
  });

  it('offers parent registration access alongside staff and volunteer links', () => {
    render(<MemoryRouter><PublicAccessNav /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Parent, staff and volunteer access' });

    const parentGroup = within(nav).getByRole('group', { name: 'Parents, guardians and players' });
    const staffGroup = within(nav).getByRole('group', { name: 'Staff and volunteers' });
    expect(within(parentGroup).getByText('Parents, guardians and players')).toBeInTheDocument();
    expect(within(parentGroup).getByRole('link', { name: 'Manage Registrations' })).toHaveAttribute('href', '/manage-registration');
    expect(within(staffGroup).getByText('Staff & volunteers')).toBeInTheDocument();
    expect(within(staffGroup).getByRole('link', { name: 'Admin sign-in' })).toHaveAttribute('href', '/admin');
    expect(within(staffGroup).getByRole('link', { name: 'Check-in login' })).toHaveAttribute('href', '/check-in');
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
  });
});
