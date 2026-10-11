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
    <nav className="app-nav public-access-nav" aria-label="Sign in options">
      <Link to="/admin/login">Chisholm Admin</Link>
      <Link to="/check-in">Committee member</Link>
      <Link to="/check-in">Volunteer</Link>
    </nav>
  );
}

export function PublicSiteHeader(): ReactElement {
  return (
    <header className="app-header public-site-header">
      <ClubLogoLink />
      <PublicAccessNav />
    </header>
  );
}
