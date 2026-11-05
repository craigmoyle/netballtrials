import { Link } from 'react-router-dom';

export function AdminHelpPage() {
  return (
    <article className="admin-help-page">
      <h1>Admin help</h1>
      <p>Use this guide to run trials from setup through the day. Each section links to the relevant screen.</p>
      <nav aria-label="Help topics">
        <a href="#events-and-registrations">Events and registrations</a>
        <a href="#planning-and-printing">Planning and printing</a>
        <a href="#communications">Communications</a>
        <a href="#settings-and-access">Settings and staff access</a>
        <a href="#privacy">Privacy and records</a>
      </nav>

      <section id="events-and-registrations" aria-labelledby="events-help-heading">
        <h2 id="events-help-heading">Events and registrations</h2>
        <p>Set the event date, arrival time, game start, finish, courts and position minimums before opening registration. Arrival time is when players should get there; game start is when rounds begin.</p>
        <p><Link to="/admin/events">Open events</Link> · <Link to="/admin/registrations">View registration totals</Link></p>
        <p>The registration overview compares paid totals with previous events in the same division and section at the same time before each trial. Current paid withdrawals are shown separately; historical totals include payments from players who later withdrew. A low count against that history can help decide whether to promote the event.</p>
        <p>Use the event roster and review queue to check individual registrations. A registration is complete after the parent email is verified and payment is confirmed. Email verification confirms access to the inbox, not guardianship.</p>
      </section>

      <section id="planning-and-printing" aria-labelledby="planning-help-heading">
        <h2 id="planning-help-heading">Planning and printing</h2>
        <p>Only checked-in players are available to the planner. Generate a draft, review its warnings and preview, then publish it to make it the active schedule.</p>
        <p><Link to="/admin/events">Open event planning tools</Link></p>
        <p>Player Statistics shows games, ranked-position assignments and appearances on each court. Repeated opponent pairings list the two players and how many games they faced each other. Player Reference shows each player’s court and position by round.</p>
        <p>Use <strong>Round handouts</strong> for one complete round per printed sheet so players can find their court, position and team. Choose portrait or landscape to fit your court count. Selector sheets are different: they are for selectors and print one court per page.</p>
      </section>

      <section id="communications" aria-labelledby="communications-help-heading">
        <h2 id="communications-help-heading">Communications</h2>
        <p>Choose the audience and filters, select recipients, then preview the final list before sending or scheduling. The preview is the last chance to check who will receive the message.</p>
        <p><Link to="/admin/communications">Open Communications</Link></p>
        <p>Templates can use the fields shown beside the message editor. Use <code>{'{{playerNames}}'}</code> when one parent may have more than one registered player. Scheduled times use Australia/Melbourne time; cancel a message before it starts if plans change.</p>
      </section>

      <section id="settings-and-access" aria-labelledby="settings-help-heading">
        <h2 id="settings-help-heading">Settings and Admin access</h2>
        <p><Link to="/admin/settings">Open Settings</Link> to manage Admin access, edit automatic confirmation and reminder copy, set reminder timing, and manage the non-secret Infisical connection.</p>
        <p>Stripe and Gmail credentials are managed in Infisical and are not editable here. Universal Auth credentials stay in deployment secret settings. Reminder timing is a lead window, not a clock time; keep the scheduled job running at least every 15 minutes.</p>
        <p>Invite a committee member once. After their initial sign-in, they can request their own links. Sign-in links are single-use and expire; each Admin needs access to their email inbox to sign in.</p>
      </section>

      <section id="privacy" aria-labelledby="privacy-help-heading">
        <h2 id="privacy-help-heading">Privacy and records</h2>
        <p>Use player history only to review possible matches across event registrations. Verify a match yourself; the app does not merge people or create permanent player profiles.</p>
        <p>Incomplete unpaid submissions are anonymized after 30 days. Completed event registration data is retained for four calendar years after the event. Keep required financial records separately.</p>
      </section>
    </article>
  );
}
