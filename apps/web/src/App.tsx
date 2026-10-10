import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { apiClient } from './api/client';
import { AdminLayout } from './AdminLayout';
import { LoginPage } from './routes/LoginPage';
import { VerifyPage } from './routes/VerifyPage';
import { EventsPage } from './routes/EventsPage';
import { EventFormPage } from './routes/EventFormPage';
import { RegisterPage } from './routes/RegisterPage';
import { RegistrationPendingPage } from './routes/RegistrationPendingPage';
import { TicketPage } from './routes/TicketPage';
import { CheckInPage } from './checkin/CheckInPage';
import { CheckInLayout } from './checkin/CheckInLayout';
import { ScanPage } from './checkin/ScanPage';
import { LookupPanel } from './checkin/LookupPanel';
import { PlannerPage } from './planner/PlannerPage';
import { SheetsPage } from './planner/SheetsPage';
import { ReviewPage } from './admin/ReviewPage';
import { MessagesPage } from './admin/MessagesPage';

const client = apiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');

type Client = ReturnType<typeof apiClient>;

function RegisterRoute({ client }: { client: Client }) {
  const { eventId } = useParams();
  if (!eventId) return <Navigate to="/" replace />;
  return <RegisterPage client={client} eventId={eventId} />;
}

function PendingRoute({ client }: { client: Client }) {
  const [params] = useSearchParams();
  const registrationId = params.get('registration');
  if (!registrationId) return <Navigate to="/" replace />;
  return <RegistrationPendingPage client={client} registrationId={registrationId} />;
}

function TicketRoute({ client }: { client: Client }) {
  const { token } = useParams();
  if (!token) return <Navigate to="/" replace />;
  return <TicketPage client={client} token={token} />;
}

function PlannerRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <PlannerPage client={client} eventId={id} />;
}

function SheetsRoute({ client }: { client: Client }) {
  const { id } = useParams();
  if (!id) return <Navigate to="/admin/events" replace />;
  return <SheetsPage client={client} eventId={id} />;
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


export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    client
      .me()
      .then(() => {
        if (active) setSignedIn(true);
      })
      .catch(() => {
        if (active) setSignedIn(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (signedIn === null) {
    return <p>Loading...</p>;
  }

  return (
    <Routes>
      <Route path="/register/:eventId" element={<RegisterRoute client={client} />} />
      <Route path="/register/:eventId/pending" element={<PendingRoute client={client} />} />
      <Route path="/ticket/:token" element={<TicketRoute client={client} />} />
      <Route path="/check-in" element={<CheckInPage client={client} />} />
      <Route
        path="/check-in/scan"
        element={
          <>
            <CheckInLayout client={client} />
            <ScanPage client={client} />
          </>
        }
      />
      <Route
        path="/check-in/lookup"
        element={
          <>
            <CheckInLayout client={client} />
            <LookupPanel client={client} />
          </>
        }
      />
      <Route path="/admin/login" element={<LoginPage client={client} />} />
      <Route
        path="/admin/verify"
        element={<VerifyPage client={client} onSignedIn={() => setSignedIn(true)} />}
      />
      <Route
        path="/admin"
        element={
          signedIn ? (
            <AdminLayout client={client} onSignOut={() => setSignedIn(false)} />
          ) : (
            <Navigate to="/admin/login" replace />
          )
        }
      >
        <Route path="events" element={<EventsPage client={client} />} />
        <Route path="events/new" element={<EventFormPage client={client} />} />
        <Route path="events/:id" element={<EventFormPage client={client} />} />
        <Route path="events/:id/plan" element={<PlannerRoute client={client} />} />
        <Route path="events/:id/sheets" element={<SheetsRoute client={client} />} />
        <Route path="events/:id/review" element={<ReviewRoute client={client} />} />
        <Route path="events/:id/messages" element={<MessagesRoute client={client} />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/events" replace />} />
    </Routes>
  );
}
