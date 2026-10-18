import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

type Workflow = { id: string; label: string; path: string };
type WorkflowGroup = { label: string; workflows: Workflow[] };

const workflowGroups: WorkflowGroup[] = [
  {
    label: 'Event',
    workflows: [
      { id: 'settings', label: 'Event settings', path: '' },
      { id: 'operations', label: 'Event operations', path: '/operations' },
      { id: 'roster', label: 'Roster and export', path: '/roster' },
      { id: 'review', label: 'Review queue', path: '/review' },
    ],
  },
  {
    label: 'Planning',
    workflows: [
      { id: 'plan', label: 'Plan rounds', path: '/plan' },
      { id: 'games', label: 'Full Game List', path: '/games' },
      { id: 'sheets', label: 'Print selector sheets', path: '/sheets' },
    ],
  },
  {
    label: 'Trial day',
    workflows: [
      { id: 'messages', label: 'Messages', path: '/messages' },
    ],
  },
];

const workflows = workflowGroups.flatMap((group) => group.workflows);
type Props = { eventId: string };

export function EventWorkflowNav({ eventId }: Props) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const basePath = `/admin/events/${eventId}`;
  const path = pathname.replace(/\/$/, '');
  const current = path === basePath
    ? 'settings'
    : workflows.find(({ path: suffix }) => suffix !== '' && path === `${basePath}${suffix}`)?.id
      ?? (path.startsWith(`${basePath}/sheets/`) ? 'sheets' : null);
  const currentLabel = workflows.find((workflow) => workflow.id === current)?.label
    ?? (path === `${basePath}/check-in` ? 'Admin check-in' : null)
    ?? (path === `${basePath}/day-of-registration` ? 'Day-of registration' : null);

  useEffect(() => setOpen(false), [pathname]);

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
      <div id="event-workflow-links" className={`workflow-links event-workflow-links${open ? ' is-open' : ''}`}>
        {workflowGroups.map((group) => (
          <div key={group.label} className="event-workflow-group" role="group" aria-label={group.label}>
            <span className="event-workflow-group-label">{group.label}</span>
            {group.workflows.map((workflow) => (
              <Link
                key={workflow.id}
                to={`${basePath}${workflow.path}`}
                aria-current={current === workflow.id ? 'page' : undefined}
              >
                {workflow.label}
              </Link>
            ))}
            {group.label === 'Trial day' ? <Link to={`/check-in?eventId=${encodeURIComponent(eventId)}`}>Volunteer check-in</Link> : null}
          </div>
        ))}
      </div>
    </nav>
  );
}
