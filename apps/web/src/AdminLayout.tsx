import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { ApiClient as Client } from './api/client';
import { ClubLogoLink, SkipToMainLink } from './SiteNavigation';
import { CONFIRM_UNSAVED_SIGN_OUT } from './useUnsavedSignOut';

const setupLinks = [
  { label: 'Member associations', path: '/admin/associations' },
  { label: 'Bib colors', path: '/admin/bib-colors' },
  { label: 'Settings', path: '/admin/settings' },
  { label: 'Staff access', path: '/admin/staff' },
];

export function AdminLayout({ client, onSignOut }: { client: Client; onSignOut: () => void }) {
  const { pathname } = useLocation();
  const setupMenu = useRef<HTMLDetailsElement>(null);
  const pending = useRef(false);
  const currentSetup = setupLinks.find((item) => item.path === pathname);

  useEffect(() => {
    if (setupMenu.current) setupMenu.current.open = false;
  }, [pathname]);
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
      <SkipToMainLink />
      <header className="app-header">
        <ClubLogoLink />
        <nav className="app-nav admin-nav" aria-label="Administration">
          <Link to="/admin/events" aria-current={pathname.startsWith('/admin/events') ? 'page' : undefined}>Events</Link>
          <Link to="/admin/registrations" aria-current={pathname === '/admin/registrations' ? 'page' : undefined}>Registrations</Link>
          <Link to="/admin/communications" aria-current={pathname === '/admin/communications' ? 'page' : undefined}>Communications</Link>
          <Link to="/admin/player-history" aria-current={pathname === '/admin/player-history' ? 'page' : undefined}>Player history</Link>
          <Link to="/admin/help" aria-current={pathname === '/admin/help' ? 'page' : undefined}>Help</Link>
          <details ref={setupMenu} className="admin-nav-menu">
            <summary>{currentSetup ? `Club setup: ${currentSetup.label}` : 'Club setup'}</summary>
            <div className="admin-nav-menu-links">
              {setupLinks.map((item) => (
                <Link key={item.path} to={item.path} aria-current={pathname === item.path ? 'page' : undefined}>{item.label}</Link>
              ))}
            </div>
          </details>
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
      <main id="main-content" className="app-main" tabIndex={-1}>
        {error ? <p role="alert">{error}</p> : null}
        <Outlet />
      </main>
    </div>
  );
}
