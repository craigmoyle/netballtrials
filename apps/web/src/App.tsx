import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { apiClient, type ApiClient as Client } from './api/client';
import { AdminLayout } from './AdminLayout';
import { EventWorkflowNav } from './admin/EventWorkflowNav';
import { PublicSiteHeader } from './SiteNavigation';
import { GAME_VIEWS, gameViewFromSearch } from './planner/game-views';

const EventOperationsPage = lazy(() => import('./admin/EventOperationsPage').then((module) => ({ default: module.EventOperationsPage })));
const LoginPage = lazy(() => import('./routes/LoginPage').then((module) => ({ default: module.LoginPage })));
const VerifyPage = lazy(() => import('./routes/VerifyPage').then((module) => ({ default: module.VerifyPage })));
const EventsPage = lazy(() => import('./routes/EventsPage').then((module) => ({ default: module.EventsPage })));
const EventFormPage = lazy(() => import('./routes/EventFormPage').then((module) => ({ default: module.EventFormPage })));
const RegisterPage = lazy(() => import('./routes/RegisterPage').then((module) => ({ default: module.RegisterPage })));
const RegistrationPendingPage = lazy(() => import('./routes/RegistrationPendingPage').then((module) => ({ default: module.RegistrationPendingPage })));
const TicketPage = lazy(() => import('./routes/TicketPage').then((module) => ({ default: module.TicketPage })));
const CheckInPage = lazy(() => import('./checkin/CheckInPage').then((module) => ({ default: module.CheckInPage })));
const AdminCheckInPage = lazy(() => import('./checkin/AdminCheckInPage').then((module) => ({ default: module.AdminCheckInPage })));
const CheckInLayout = lazy(() => import('./checkin/CheckInLayout').then((module) => ({ default: module.CheckInLayout })));
const ScanPage = lazy(() => import('./checkin/ScanPage').then((module) => ({ default: module.ScanPage })));
const LookupPanel = lazy(() => import('./checkin/LookupPanel').then((module) => ({ default: module.LookupPanel })));
const PlannerPage = lazy(() => import('./planner/PlannerPage').then((module) => ({ default: module.PlannerPage })));
const FullGameListPage = lazy(() => import('./planner/FullGameListPage').then((module) => ({ default: module.FullGameListPage })));
const SheetsPage = lazy(() => import('./planner/SheetsPage').then((module) => ({ default: module.SheetsPage })));
const BlankSheetPage = lazy(() => import('./planner/BlankSheetPage').then((module) => ({ default: module.BlankSheetPage })));
const RoundSheetsPage = lazy(() => import('./planner/RoundSheetsPage').then((module) => ({ default: module.RoundSheetsPage })));
const ReviewPage = lazy(() => import('./admin/ReviewPage').then((module) => ({ default: module.ReviewPage })));
const MessagesPage = lazy(() => import('./admin/MessagesPage').then((module) => ({ default: module.MessagesPage })));
const RosterPage = lazy(() => import('./admin/RosterPage').then((module) => ({ default: module.RosterPage })));
const RegistrationChangeHistoryPage = lazy(() => import('./admin/RegistrationChangeHistoryPage').then((module) => ({ default: module.RegistrationChangeHistoryPage })));
const AssociationsPage = lazy(() => import('./admin/AssociationsPage').then((module) => ({ default: module.AssociationsPage })));
const BibColorsPage = lazy(() => import('./admin/BibColorsPage').then((module) => ({ default: module.BibColorsPage })));
const StaffAccessPage = lazy(() => import('./admin/StaffAccessPage').then((module) => ({ default: module.StaffAccessPage })));
const PlayerHistoryPage = lazy(() => import('./admin/PlayerHistoryPage').then((module) => ({ default: module.PlayerHistoryPage })));
const IncompleteRegistrationsPage = lazy(() => import('./admin/IncompleteRegistrationsPage').then((module) => ({ default: module.IncompleteRegistrationsPage })));
const SiteCommunicationsPage = lazy(() => import('./admin/SiteCommunicationsPage').then((module) => ({ default: module.SiteCommunicationsPage })));
const SettingsPage = lazy(() => import('./admin/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const RegistrationOverviewPage = lazy(() => import('./admin/RegistrationOverviewPage').then((module) => ({ default: module.RegistrationOverviewPage })));
const AdminHelpPage = lazy(() => import('./admin/AdminHelpPage').then((module) => ({ default: module.AdminHelpPage })));
const PublicHomePage = lazy(() => import('./routes/PublicHomePage').then((module) => ({ default: module.PublicHomePage })));
const ParentAccessPage = lazy(() => import('./routes/ParentAccessPage').then((module) => ({ default: module.ParentAccessPage })));

const client = apiClient(import.meta.env.VITE_API_URL ?? '');

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, 'Upcoming trials'],
  [/^\/register\/[^/]+\/pending$/, 'Complete registration'],
  [/^\/register\//, 'Register for trials'],
  [/^\/ticket\//, 'Your trial ticket'],
  [/^\/manage-registration(?:\/verify)?$/, 'Manage registrations'],
  [/^\/check-in\/scan$/, 'Check-in scanner'],
  [/^\/check-in\/lookup$/, 'Find a player'],
  [/^\/check-in$/, 'Volunteer check-in'],
  [/^\/admin\/login$/, 'Staff sign in'],
  [/^\/admin\/verify$/, 'Verify staff sign in'],
  [/^\/admin\/events\/[^/]+\/operations$/, 'Event operations'],
  [/^\/admin\/events\/[^/]+\/check-in$/, 'Admin check-in'],
  [/^\/admin\/events\/[^/]+\/day-of-registration$/, 'Admin-assisted registration'],
  [/^\/admin\/events\/new$/, 'New event'],
  [/^\/admin\/events\/[^/]+\/roster\/[^/]+\/changes$/, 'Registration change history'],
  [/^\/admin\/events\/[^/]+\/roster$/, 'Event roster'],
  [/^\/admin\/events\/[^/]+\/incomplete$/, 'Incomplete registrations'],
  [/^\/admin\/communications$/, 'Communications'],
  [/^\/admin\/registrations$/, 'Registration overview'],
  [/^\/admin\/help$/, 'Admin help'],
  [/^\/admin\/settings$/, 'Settings'],
  [/^\/admin\/associations$/, 'Member associations'],
  [/^\/admin\/bib-colors$/, 'Bib colors'],
  [/^\/admin\/staff$/, 'Staff access'],
  [/^\/admin\/player-history$/, 'Player history'],
  [/^\/admin\/events\/[^/]+\/plan$/, 'Trial planner'],
  [/^\/admin\/events\/[^/]+\/round-sheets$/, 'Round handouts'],
  [/^\/admin\/events\/[^/]+\/sheets\/blank$/, 'Blank game sheet'],
  [/^\/admin\/events\/[^/]+\/sheets$/, 'Selector sheets'],
  [/^\/admin\/events\/[^/]+\/review$/, 'Review queue'],
  [/^\/admin\/events\/[^/]+\/(?:communications|messages)$/, 'Communications'],
  [/^\/admin\/events\/[^/]+$/, 'Event settings'],
  [/^\/admin\/events$/, 'Events'],
  [/^\/admin/, 'Administration'],
];

function pageTitle(pathname: string, search = ''): string {
  const gameView = /^\/admin\/events\/[^/]+\/games$/.test(pathname)
    ? GAME_VIEWS.find((view) => view.id === gameViewFromSearch(search))?.label
    : undefined;
  return `${gameView ?? TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'Page not found'} | Chisholm Netball Trials`;
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
      <main id="main-content" className="app-main" tabIndex={-1}>{children}</main>
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

function RoundSheetsRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <RoundSheetsPage client={client} eventId={id} />;
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

function RegistrationChangesRoute({ client }: { client: Client }) {
  const { id, registrationId } = useParams();
  if (!id || !registrationId) return <Navigate to="/admin/events" replace />;
  return <RegistrationChangeHistoryPage client={client} eventId={id} registrationId={registrationId} />;
}

function IncompleteRegistrationsRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <IncompleteRegistrationsPage client={client} eventId={id} />;
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
  const [appEnv, setAppEnv] = useState<'testing' | 'production' | null>(null);
  const [testIntegrationsEnabled, setTestIntegrationsEnabled] = useState(false);
  const [testAccessRequired, setTestAccessRequired] = useState(false);
  const [runtimeLoaded, setRuntimeLoaded] = useState(false);
  const [testAdminAccess, setTestAdminAccess] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    client.getRuntimeEnvironment()
      .then(({ appEnv: loaded, testAccessRequired: testAccess, testIntegrationsEnabled: testIntegrations }) => {
        if (!active) return;
        setAppEnv(loaded);
        setTestAccessRequired(testAccess);
        setTestIntegrationsEnabled(testIntegrations);
      })
      .catch(() => { if (active) { setAppEnv('production'); setTestAccessRequired(true); } })
      .finally(() => { if (active) setRuntimeLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!testAccessRequired) return;
    if (['/admin/login', '/admin/verify'].includes(location.pathname)) {
      setTestAdminAccess(true);
      return;
    }
    let active = true;
    setTestAdminAccess(null);
    client.me()
      .then(() => { if (active) setTestAdminAccess(true); })
      .catch(() => { if (active) setTestAdminAccess(false); });
    return () => { active = false; };
  }, [location.pathname, testAccessRequired]);

  useEffect(() => {
    document.title = pageTitle(location.pathname, location.search);
  }, [location.pathname, location.search]);

  if (!runtimeLoaded) return <p role="status">Checking application environment…</p>;
  if (testAccessRequired && !['/admin/login', '/admin/verify'].includes(location.pathname)) {
    if (testAdminAccess === null) return <p role="status">Checking test access…</p>;
    if (!testAdminAccess) return <Navigate to="/admin/login" replace />;
  }

  return (
    <>
      {appEnv === 'testing' ? <div className="environment-banner" role="note">{testIntegrationsEnabled ? 'TEST ENVIRONMENT — Stripe test mode; email is limited to the approved test mailbox' : 'TEST ENVIRONMENT — payments and email are simulated'}</div> : null}
      <Suspense fallback={<p role="status">Loading page…</p>}>
        <Routes>
      <Route path="/" element={<><PublicSiteHeader /><PublicHomePage client={client} /></>} />
      <Route path="/register/:eventId" element={<PageContent><RegisterRoute client={client} /></PageContent>} />
      <Route path="/register/:eventId/pending" element={<PageContent><PendingRoute client={client} /></PageContent>} />
      <Route path="/ticket/:token" element={<PageContent><TicketRoute client={client} /></PageContent>} />
      <Route path="/manage-registration" element={<PageContent><ParentAccessPage client={client} /></PageContent>} />
      <Route path="/manage-registration/verify" element={<PageContent><ParentAccessPage client={client} /></PageContent>} />
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
          <Route path="roster/:registrationId/changes" element={<RegistrationChangesRoute client={client} />} />
          <Route path="incomplete" element={<IncompleteRegistrationsRoute client={client} />} />
          <Route path="check-in" element={<AdminCheckInRoute client={client} />} />
          <Route path="day-of-registration" element={<DayOfRegistrationRoute client={client} />} />
          <Route path="plan" element={<PlannerRoute client={client} />} />
          <Route path="games" element={<GamesRoute client={client} />} />
          <Route path="round-sheets" element={<RoundSheetsRoute client={client} />} />
          <Route path="sheets/blank" element={<BlankSheetRoute client={client} />} />
          <Route path="sheets" element={<SheetsRoute client={client} />} />
          <Route path="review" element={<ReviewRoute client={client} />} />
          <Route path="communications" element={<MessagesRoute client={client} />} />
          <Route path="messages" element={<MessagesRoute client={client} />} />
        </Route>
        <Route path="communications" element={<SiteCommunicationsPage client={client} />} />
        <Route path="registrations" element={<RegistrationOverviewPage client={client} />} />
        <Route path="help" element={<AdminHelpPage />} />
        <Route path="settings" element={<SettingsPage client={client} />} />
        <Route path="associations" element={<AssociationsPage client={client} />} />
        <Route path="bib-colors" element={<BibColorsPage client={client} />} />
        <Route path="staff" element={<StaffAccessPage client={client} />} />
        <Route path="player-history" element={<PlayerHistoryPage client={client} />} />
      </Route>
      <Route path="*" element={<PageContent><h1>Page not found</h1><Link to="/admin/login">Staff sign in</Link></PageContent>} />
        </Routes>
      </Suspense>
    </>
  );
}
