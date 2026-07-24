// Web entrypoint. Mounts the same gated <App /> as Electron.
//
// App.tsx runs the onboarding gates (Intro, Terms, Setup, Onboarding, cowork).
// Each gate's bridge call goes through `host.*`, which routes to ~/.anton/.env
// via FastAPI in web and via window.antontron in Electron. Setup auto-completes
// on web (the FastAPI host running this code IS the install).
//
// Auth: every web instance requires a Keycloak login (onLoad 'login-required'),
// same as the MindsHub console (mindshub_frontend). An unauthenticated visitor
// is redirected to Keycloak before <App /> mounts; the resulting token rides as
// `Authorization: Bearer` on every /api call (see host.ts / cowork/api.js),
// which the ingress auth subrequest validates. There is no separate "cloud"
// bypass: the old Cloudflare-Worker standalone path is retired.
//
// Same as main.tsx:
//   - First-paint theme bootstrap (avoids palette flash).
//   - Tailwind + cowork tokens loaded in the same order.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactKeycloakProvider } from '@react-keycloak/web';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import App from './App';
import { keycloak } from './lib/keycloak';
import { loadSkin } from './lib/skins';

(() => {
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = window.localStorage.getItem('anton.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.body.dataset.theme = theme;
  document.body.dataset.skin = loadSkin();
  document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
})();

// Base URL without query params. Keycloak validates redirect URIs strictly.
const cleanRedirectUri = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
const initOptions = { onLoad: 'login-required' as const, pkceMethod: 'S256', checkLoginIframe: false, redirectUri: cleanRedirectUri };

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <ReactKeycloakProvider authClient={keycloak} initOptions={initOptions}>
      <App />
    </ReactKeycloakProvider>
  </StrictMode>
);
