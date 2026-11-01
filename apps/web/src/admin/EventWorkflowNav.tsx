import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GAME_VIEWS } from '../planner/game-views';

type Workflow = { id: string; label: string; path: string; search?: string };
type WorkflowGroup = { label: string; workflows: Workflow[] };

const workflowGroups: WorkflowGroup[] = [
  {
    label: 'Event',
    workflows: [
      { id: 'settings', label: 'Event settings', path: '' },
      { id: 'operations', label: 'Event operations', path: '/operations' },
    ],
  },
  {
    label: 'Registration',
    workflows: [
      { id: 'roster', label: 'Roster and export', path: '/roster' },
      { id: 'review', label: 'Review queue', path: '/review' },
      { id: 'incomplete', label: 'Incomplete registrations', path: '/incomplete' },
    ],
  },
  {
    label: 'Planning',
    workflows: [
      { id: 'plan', label: 'Plan rounds', path: '/plan' },
      ...GAME_VIEWS.map((view) => ({ id: `games-${view.id}`, label: view.label, path: '/games', search: view.search })),
      { id: 'round-sheets', label: 'Round handouts', path: '/round-sheets' },
      { id: 'sheets', label: 'Print selector sheets', path: '/sheets' },
    ],
  },
  {
    label: 'Trial day',
    workflows: [],
  },
  {
    label: 'Communications',
    workflows: [
      { id: 'messages', label: 'Event communications', path: '/communications' },
    ],
  },
];

const workflows = workflowGroups.flatMap((group) => group.workflows);
type Props = { eventId: string };

export function EventWorkflowNav({ eventId }: Props) {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const basePath = `/admin/events/${eventId}`;
  const path = pathname.replace(/\/$/, '');
  const current = path === basePath && !search
    ? 'settings'
    : workflows.find(({ path: suffix, search: targetSearch }) =>
      suffix !== '' && path === `${basePath}${suffix}` && (targetSearch ?? '') === search,
    )?.id
      ?? (path === `${basePath}/messages` ? 'messages' : null)
      ?? (path.startsWith(`${basePath}/sheets/`) ? 'sheets' : null);
  const specialCurrent = path === `${basePath}/check-in`
    ? 'Admin check-in'
    : path === `${basePath}/day-of-registration` ? 'Day-of registration' : null;
  const currentLabel = workflows.find((workflow) => workflow.id === current)?.label ?? specialCurrent;

  useEffect(() => setOpen(false), [pathname, search]);

  return (
    <nav aria-label="Event workflows" className="event-workflow-nav">
      <button
        type="button"
        className="button-secondary event-workflow-toggle"
        aria-expanded={open}
        aria-controls="event-workflow-links"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        Event tools{currentLabel ? `: ${currentLabel}` : ''}
      </button>
      <div id="event-workflow-links" className={`workflow-links event-workflow-links event-workflow-grid${open ? ' is-open' : ''}`}>
        {workflowGroups.map((group) => (
          <div key={group.label} className="event-workflow-group" role="group" aria-label={group.label}>
            <span className="event-workflow-group-label">{group.label}</span>
            {group.workflows.map((workflow) => (
              <Link
                key={workflow.id}
                to={`${basePath}${workflow.path}${workflow.search ?? ''}`}
                aria-current={current === workflow.id ? 'page' : undefined}
              >
                {workflow.label}
              </Link>
            ))}
            {group.label === 'Trial day' && specialCurrent ? <span aria-current="page">{specialCurrent}</span> : null}
            {group.label === 'Trial day' ? <Link to={`/check-in?eventId=${encodeURIComponent(eventId)}`}>Volunteer check-in</Link> : null}
          </div>
        ))}
      </div>
    </nav>
  );
}
