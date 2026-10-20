import { Link, Outlet, useLocation } from 'react-router-dom';
import type { apiClient } from './api/client';
import { ClubLogoLink } from './SiteNavigation';

type Client = ReturnType<typeof apiClient>;

export function AdminLayout({ client, onSignOut }: { client: Client; onSignOut: () => void }) {
  const { pathname } = useLocation();
  return (
    <div className="app-shell">
      <header className="app-header">
        <ClubLogoLink />
        <nav className="app-nav" aria-label="Administration">
          <Link to="/admin/events" aria-current={pathname.startsWith('/admin/events') ? 'page' : undefined}>Events</Link>
          <Link to="/admin/associations" aria-current={pathname.startsWith('/admin/associations') ? 'page' : undefined}>Member associations</Link>
          <Link to="/admin/bib-colors" aria-current={pathname.startsWith('/admin/bib-colors') ? 'page' : undefined}>Bib colors</Link>
        </nav>
        <button
          type="button"
          data-confirm-unsaved-navigation
          onClick={async () => {
            await client.logout();
            onSignOut();
          }}
        >
          Sign out
        </button>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
