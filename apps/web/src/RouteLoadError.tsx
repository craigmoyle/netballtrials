import { Link } from 'react-router-dom';

export function RouteLoadError() {
  return (
    <main className="app-load-error">
      <div role="alert">
        <h1>This page couldn’t load</h1>
        <p>Reload the page to try again, or return to Events.</p>
      </div>
      <div className="app-load-error-actions">
        <button type="button" className="button-primary" onClick={() => window.location.reload()}>Reload page</button>
        <Link to="/admin/events">Return to Events</Link>
      </div>
    </main>
  );
}
