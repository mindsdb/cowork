// Web entrypoint. Mounts the same gated <App /> as Electron.
//
// App.tsx runs the onboarding gates (Intro, Terms, Setup, Onboarding, cowork).
// Each gate's bridge call goes through `host.*`, which routes to ~/.anton/.env
// via FastAPI in web and via window.antontron in Electron. Setup auto-completes
// on web (the FastAPI host running this code IS the install).
//
// Auth is decided by <WebAuthGate> (see lib/devLogin). A deployed build always
// requires a Keycloak login (onLoad 'login-required'), same as the MindsHub
// console: an unauthenticated visitor is redirected to Keycloak before <App />
// mounts; the resulting token rides as `Authorization: Bearer` on every /api
// call (see host.ts / cowork/api.js), which the ingress auth subrequest
// validates. Under `vite dev` only, the gate instead mounts the app without
// auth (localhost has no ingress gate and isn't a registered redirect URI), or
// runs a local ROPC dev-login when VITE_DEV_LOGIN=true. Those dev branches are
// tree-shaken out of `build:web`.
//
// Same as main.tsx:
//   - First-paint theme bootstrap (avoids palette flash).
//   - Tailwind + cowork tokens loaded in the same order.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import App from './App';
import { WebAuthGate } from './lib/devLogin';
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

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <WebAuthGate>
      <App />
    </WebAuthGate>
  </StrictMode>
);
