import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { apiClient } from './api/client';
import { AdminLayout } from './AdminLayout';
import { LoginPage } from './routes/LoginPage';
import { VerifyPage } from './routes/VerifyPage';
import { EventsPage } from './routes/EventsPage';
import { EventFormPage } from './routes/EventFormPage';

const client = apiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');

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
      </Route>
      <Route path="*" element={<Navigate to="/admin/events" replace />} />
    </Routes>
  );
}
