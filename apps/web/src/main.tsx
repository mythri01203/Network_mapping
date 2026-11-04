import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { syncEngine } from './api/syncEngine';
import App from './app/App';

syncEngine.start();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
