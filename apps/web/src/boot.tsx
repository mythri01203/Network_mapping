import React from 'react';
import ReactDOM from 'react-dom/client';

import { syncEngine } from './api/syncEngine';
import App from './app/App';

/**
 * Everything that reads the offline copy of the network. Loaded by `main.tsx` only after the office
 * cache (IndexedDB, Phase 19) has been read into memory, so the network store starts from it.
 */
syncEngine.start();
// Field photos keep uploading on any screen, so they leave the phone as soon as there is signal.
void import('./features/capture/captureRuntime').then((m) => m.startCaptureRuntime());

// Offline app shell. Production only: the dev server must never be cached. Browsers allow service
// workers only on https or localhost, so a phone on plain http over the LAN simply goes without.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => console.warn('Offline support could not start', error));
  // The page may already have loaded while the cache was being read.
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register());
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
