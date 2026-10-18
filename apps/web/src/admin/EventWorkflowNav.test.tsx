import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventWorkflowNav } from './EventWorkflowNav';

describe('EventWorkflowNav', () => {
  it('groups event, planning, and trial-day workflows and marks the current route', () => {
    render(
      <MemoryRouter initialEntries={['/admin/events/e1/operations']}>
        <EventWorkflowNav eventId="e1" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Event workflows' });
    const eventGroup = within(nav).getByRole('group', { name: 'Event' });
    const planningGroup = within(nav).getByRole('group', { name: 'Planning' });
    const trialDayGroup = within(nav).getByRole('group', { name: 'Trial day' });

    expect(within(eventGroup).getByRole('link', { name: 'Event settings' })).toHaveAttribute('href', '/admin/events/e1');
    expect(within(eventGroup).getByRole('link', { name: 'Event operations' })).toHaveAttribute('aria-current', 'page');
    expect(within(eventGroup).getByRole('link', { name: 'Roster and export' })).toBeInTheDocument();
    expect(within(planningGroup).getByRole('link', { name: 'Plan rounds' })).toBeInTheDocument();
    expect(within(planningGroup).getByRole('link', { name: 'Print selector sheets' })).toBeInTheDocument();
    expect(within(trialDayGroup).getByRole('link', { name: 'Messages' })).toBeInTheDocument();
    expect(within(trialDayGroup).getByRole('link', { name: 'Volunteer check-in' })).toHaveAttribute('href', '/check-in?eventId=e1');
    expect(screen.getByRole('button', { name: 'Event tools: Event operations' })).toHaveAttribute('aria-expanded', 'false');
  });
});
