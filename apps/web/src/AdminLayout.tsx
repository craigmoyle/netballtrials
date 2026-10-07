import { Outlet } from 'react-router-dom';
import type { apiClient } from './api/client';

type Client = ReturnType<typeof apiClient>;

export function AdminLayout({ client, onSignOut }: { client: Client; onSignOut: () => void }) {
  return (
    <div>
      <header>
        <h1>Netball Trials Admin</h1>
        <nav>
          <a href="/admin/events">Events</a>
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
      <main>
        <Outlet />
      </main>
    </div>
  );
}
