import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { RouteLoadError } from './RouteLoadError';
import './styles.css';

const preloadRecoveryKey = 'netballtrials-preload-reload-at';
window.addEventListener('vite:preloadError', (event) => {
  try {
    const lastReload = Number(sessionStorage.getItem(preloadRecoveryKey) ?? 0);
    if (Date.now() - lastReload < 30_000) return;
    sessionStorage.setItem(preloadRecoveryKey, String(Date.now()));
    event.preventDefault();
    window.location.reload();
  } catch {
    // Let the route error screen handle the failure when session storage is unavailable.
  }
});

const router = createBrowserRouter([{ path: '*', element: <App />, errorElement: <RouteLoadError /> }]);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
