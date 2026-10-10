import { Link, Outlet } from 'react-router-dom';
import type { apiClient } from './api/client';

type Client = ReturnType<typeof apiClient>;

export function AdminLayout({ client, onSignOut }: { client: Client; onSignOut: () => void }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="app-brand" to="/admin/events">Chisholm Netball Region</Link>
        <nav className="app-nav" aria-label="Administration">
          <Link to="/admin/events">Events</Link>
        </nav>
        <button
          type="button"
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
