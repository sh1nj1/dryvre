import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import LandingPage from './LandingPage';

const isAppRoute =
  window.location.pathname === '/app' ||
  window.location.pathname.startsWith('/app/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAppRoute ? <App /> : <LandingPage />}</StrictMode>,
);
