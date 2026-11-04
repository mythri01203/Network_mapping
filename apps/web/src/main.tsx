import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { syncEngine } from './api/syncEngine';
import './index.css';

syncEngine.start();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
