import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { apiClient, type ApiClient as Client } from './api/client';
import { AdminLayout } from './AdminLayout';
import { EventWorkflowNav } from './admin/EventWorkflowNav';
import { EventOperationsPage } from './admin/EventOperationsPage';
import { LoginPage } from './routes/LoginPage';
import { VerifyPage } from './routes/VerifyPage';
import { EventsPage } from './routes/EventsPage';
import { EventFormPage } from './routes/EventFormPage';
import { RegisterPage } from './routes/RegisterPage';
import { RegistrationPendingPage } from './routes/RegistrationPendingPage';
import { TicketPage } from './routes/TicketPage';
import { CheckInPage } from './checkin/CheckInPage';
import { AdminCheckInPage } from './checkin/AdminCheckInPage';
import { CheckInLayout } from './checkin/CheckInLayout';
import { ScanPage } from './checkin/ScanPage';
import { LookupPanel } from './checkin/LookupPanel';
import { PlannerPage } from './planner/PlannerPage';
import { FullGameListPage } from './planner/FullGameListPage';
import { SheetsPage } from './planner/SheetsPage';
import { BlankSheetPage } from './planner/BlankSheetPage';
import { ReviewPage } from './admin/ReviewPage';
import { MessagesPage } from './admin/MessagesPage';
import { RosterPage } from './admin/RosterPage';
import { AssociationsPage } from './admin/AssociationsPage';
import { BibColorsPage } from './admin/BibColorsPage';
import { StaffAccessPage } from './admin/StaffAccessPage';
import { PlayerHistoryPage } from './admin/PlayerHistoryPage';
import { PublicHomePage } from './routes/PublicHomePage';
import { PublicSiteHeader } from './SiteNavigation';

const client = apiClient(import.meta.env.VITE_API_URL ?? '');

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, 'Upcoming trials'],
  [/^\/register\/[^/]+\/pending$/, 'Complete registration'],
  [/^\/register\//, 'Register for trials'],
  [/^\/ticket\//, 'Your trial ticket'],
  [/^\/check-in\/scan$/, 'Check-in scanner'],
  [/^\/check-in\/lookup$/, 'Find a player'],
  [/^\/check-in$/, 'Volunteer check-in'],
  [/^\/admin\/login$/, 'Staff sign in'],
  [/^\/admin\/verify$/, 'Verify staff sign in'],
  [/^\/admin\/events\/[^/]+\/operations$/, 'Event operations'],
  [/^\/admin\/events\/[^/]+\/check-in$/, 'Admin check-in'],
  [/^\/admin\/events\/[^/]+\/day-of-registration$/, 'Admin-assisted registration'],
  [/^\/admin\/events\/new$/, 'New event'],
  [/^\/admin\/events\/[^/]+\/roster$/, 'Event roster'],
  [/^\/admin\/associations$/, 'Member associations'],
  [/^\/admin\/bib-colors$/, 'Bib colors'],
  [/^\/admin\/staff$/, 'Staff access'],
  [/^\/admin\/player-history$/, 'Player history'],
  [/^\/admin\/events\/[^/]+\/plan$/, 'Trial planner'],
  [/^\/admin\/events\/[^/]+\/games$/, 'Full Game List'],
  [/^\/admin\/events\/[^/]+\/sheets\/blank$/, 'Blank game sheet'],
  [/^\/admin\/events\/[^/]+\/sheets$/, 'Selector sheets'],
  [/^\/admin\/events\/[^/]+\/review$/, 'Review queue'],
  [/^\/admin\/events\/[^/]+\/(?:communications|messages)$/, 'Communications'],
  [/^\/admin\/events\/[^/]+$/, 'Event settings'],
  [/^\/admin\/events$/, 'Events'],
  [/^\/admin/, 'Administration'],
];

function pageTitle(pathname: string): string {
  return `${TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Page not found'} | Chisholm Netball Trials`;
}

function ProtectedAdmin({ client }: { client: Client }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    client.me()
      .then(() => { if (active) setSignedIn(true); })
      .catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, [client]);

  if (signedIn === null) return <p role="status">Checking staff session...</p>;
  if (!signedIn) return <Navigate to="/admin/login" replace />;
  return <AdminLayout client={client} onSignOut={() => setSignedIn(false)} />;
}

function RegisterRoute({ client }: { client: Client }) {
  const { eventId } = useParams();
  if (!eventId) return <Navigate to="/" replace />;
  return <RegisterPage key={eventId} client={client} eventId={eventId} />;
}

function PendingRoute({ client }: { client: Client }) {
  const [params] = useSearchParams();
  const checkoutSessionId = params.get('session');
  if (!checkoutSessionId) return <Navigate to="/" replace />;
  return <RegistrationPendingPage client={client} checkoutSessionId={checkoutSessionId} />;
}

function TicketRoute({ client }: { client: Client }) {
  const { token } = useParams();
  if (!token) return <Navigate to="/" replace />;
  return <TicketPage client={client} token={token} />;
}

function PageContent({ children, showPublicHeader = true }: { children: ReactNode; showPublicHeader?: boolean }) {
  return (
    <>
      {showPublicHeader ? <PublicSiteHeader /> : null}
      <main className="app-main">{children}</main>
    </>
  );
}

function EventWorkspaceLayout() {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <><EventWorkflowNav eventId={id} /><Outlet /></>;
}

function PlannerRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <PlannerPage client={client} eventId={id} />;
}

function GamesRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <FullGameListPage client={client} eventId={id} />;
}

function SheetsRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <SheetsPage client={client} eventId={id} />;
}

function BlankSheetRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <BlankSheetPage client={client} eventId={id} />;
}

function ReviewRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <ReviewPage client={client} eventId={id} />;
}

function MessagesRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <MessagesPage client={client} eventId={id} />;
}

function RosterRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <RosterPage client={client} eventId={id} />;
}

function EventOperationsRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <EventOperationsPage client={client} eventId={id} />;
}

function AdminCheckInRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <AdminCheckInPage client={client} eventId={id} />;
}

function DayOfRegistrationRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <RegisterPage key={id} client={client} eventId={id} adminAssisted />;
}

export function App() {
  const location = useLocation();
  useEffect(() => {
    document.title = pageTitle(location.pathname);
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<><PublicSiteHeader /><PublicHomePage client={client} /></>} />
      <Route path="/register/:eventId" element={<PageContent><RegisterRoute client={client} /></PageContent>} />
      <Route path="/register/:eventId/pending" element={<PageContent><PendingRoute client={client} /></PageContent>} />
      <Route path="/ticket/:token" element={<PageContent><TicketRoute client={client} /></PageContent>} />
      <Route path="/check-in" element={<PageContent><CheckInPage client={client} /></PageContent>} />
      <Route
        path="/check-in/scan"
        element={<><CheckInLayout client={client} /><PageContent showPublicHeader={false}><ScanPage client={client} /></PageContent></>}
      />
      <Route
        path="/check-in/lookup"
        element={<><CheckInLayout client={client} /><PageContent showPublicHeader={false}><LookupPanel client={client} /></PageContent></>}
      />
      <Route path="/admin/login" element={<PageContent><LoginPage client={client} /></PageContent>} />
      <Route path="/admin/verify" element={<PageContent><VerifyPage client={client} onSignedIn={() => undefined} /></PageContent>} />
      <Route path="/admin" element={<ProtectedAdmin client={client} />}>
        <Route index element={<Navigate to="events" replace />} />
        <Route path="events" element={<EventsPage client={client} />} />
        <Route path="events/new" element={<EventFormPage client={client} />} />
        <Route path="events/:id" element={<EventWorkspaceLayout />}>
          <Route index element={<EventFormPage client={client} />} />
          <Route path="operations" element={<EventOperationsRoute client={client} />} />
          <Route path="roster" element={<RosterRoute client={client} />} />
          <Route path="check-in" element={<AdminCheckInRoute client={client} />} />
          <Route path="day-of-registration" element={<DayOfRegistrationRoute client={client} />} />
          <Route path="plan" element={<PlannerRoute client={client} />} />
          <Route path="games" element={<GamesRoute client={client} />} />
          <Route path="sheets/blank" element={<BlankSheetRoute client={client} />} />
          <Route path="sheets" element={<SheetsRoute client={client} />} />
          <Route path="review" element={<ReviewRoute client={client} />} />
          <Route path="communications" element={<MessagesRoute client={client} />} />
          <Route path="messages" element={<MessagesRoute client={client} />} />
        </Route>
        <Route path="associations" element={<AssociationsPage client={client} />} />
        <Route path="bib-colors" element={<BibColorsPage client={client} />} />
        <Route path="staff" element={<StaffAccessPage client={client} />} />
        <Route path="player-history" element={<PlayerHistoryPage client={client} />} />
      </Route>
      <Route path="*" element={<PageContent><h1>Page not found</h1><Link to="/admin/login">Staff sign in</Link></PageContent>} />
    </Routes>
  );
}
