import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { syncEngine } from './api/syncEngine';
import App from './app/App';

syncEngine.start();
// Field photos keep uploading on any screen, so they leave the phone as soon as there is signal.
void import('./features/capture/captureRuntime').then((m) => m.startCaptureRuntime());

// Offline app shell. Production only: the dev server must never be cached. Browsers allow service
// workers only on https or localhost, so a phone on plain http over the LAN simply goes without.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => console.warn('Offline support could not start', error));
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
