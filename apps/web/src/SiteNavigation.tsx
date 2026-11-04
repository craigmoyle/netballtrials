import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

export function ClubLogoLink(): ReactElement {
  return (
    <Link className="app-brand" to="/" aria-label="Trials home">
      <img src="/chisholm-netball-logo.jpg" alt="Chisholm Netball logo" width={171} height={57} />
    </Link>
  );
}

export function PublicAccessNav(): ReactElement {
  return (
    <nav className="app-nav public-access-nav" aria-label="Parent, staff and volunteer access">
      <div className="public-access-group" role="group" aria-label="Parents, guardians and players">
        <span className="public-access-label">Parents, guardians and players</span>
        <Link to="/manage-registration">Manage Registrations</Link>
      </div>
      <div className="public-access-group" role="group" aria-label="Staff and volunteers">
        <span className="public-access-label">Staff &amp; volunteers</span>
        <Link to="/admin">Admin sign-in</Link>
        <Link to="/check-in">Check-in login</Link>
      </div>
    </nav>
  );
}

export function SkipToMainLink(): ReactElement {
  return <a className="skip-link" href="#main-content">Skip to main content</a>;
}

export function PublicSiteHeader(): ReactElement {
  return (
    <>
      <SkipToMainLink />
      <header className="app-header public-site-header">
        <ClubLogoLink />
        <PublicAccessNav />
      </header>
    </>
  );
}
