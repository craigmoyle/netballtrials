import { useRef, useState, type SyntheticEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { ApiClient as Client } from './api/client';
import { ClubLogoLink } from './SiteNavigation';
import { CONFIRM_UNSAVED_SIGN_OUT } from './useUnsavedSignOut';

export function AdminLayout({ client, onSignOut }: { client: Client; onSignOut: () => void }) {
  const { pathname } = useLocation();
  const pending = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (pending.current || !document.dispatchEvent(new Event(CONFIRM_UNSAVED_SIGN_OUT, { cancelable: true }))) return;
    pending.current = true;
    setSigningOut(true);
    setError(null);
    try {
      await client.logout();
      onSignOut();
    } catch {
      setError('Could not sign out. Your work is still here; try again.');
    } finally {
      pending.current = false;
      setSigningOut(false);
    }
  }

  function blockWhileSigningOut(event: SyntheticEvent) {
    if (!pending.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div className="app-shell" inert={signingOut} onClickCapture={blockWhileSigningOut} onChangeCapture={blockWhileSigningOut} onSubmitCapture={blockWhileSigningOut}>
      <header className="app-header">
        <ClubLogoLink />
        <nav className="app-nav" aria-label="Administration">
          <Link to="/admin/events" aria-current={pathname.startsWith('/admin/events') ? 'page' : undefined}>Events</Link>
          <Link to="/admin/associations" aria-current={pathname.startsWith('/admin/associations') ? 'page' : undefined}>Member associations</Link>
          <Link to="/admin/bib-colors" aria-current={pathname.startsWith('/admin/bib-colors') ? 'page' : undefined}>Bib colors</Link>
          <Link to="/admin/staff" aria-current={pathname.startsWith('/admin/staff') ? 'page' : undefined}>Staff access</Link>
        </nav>
        <button
          type="button"
          data-confirm-unsaved-navigation
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </header>
      <main className="app-main">
        {error ? <p role="alert">{error}</p> : null}
        <Outlet />
      </main>
    </div>
  );
}
