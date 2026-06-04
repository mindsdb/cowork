// Web entrypoint — mounts the same gated <App /> as Electron.
//
// App.tsx runs the onboarding gates (Intro → Terms → Setup →
// Onboarding → cowork). Each gate's bridge call now goes through
// `host.*`, which routes to ~/.anton/.env via FastAPI in web and via
// window.antontron in Electron. Setup auto-completes on web (the
// FastAPI host running this code IS the install).
//
// Same as main.tsx:
//   - First-paint theme bootstrap (avoids palette flash).
//   - Tailwind + cowork tokens loaded in the same order.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactKeycloakProvider } from '@react-keycloak/web';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './styles.css';
import App from './App';
import { keycloak, scheduleWebTokenRefresh } from './lib/keycloak';
import { host } from './platform/host';

(() => {
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = window.localStorage.getItem('anton.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.body.dataset.theme = theme;
  document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
})();

const initOptions = { onLoad: 'login-required' as const, pkceMethod: 'S256', checkLoginIframe: false };

const MINDS_ENV = (token: string) => [
  `ANTON_OPENAI_API_KEY=${token}`,
  `ANTON_MINDS_API_KEY=${token}`,
  `ANTON_OPENAI_BASE_URL=https://api.mindshub.ai/v1`,
].join('\n');

let stopRefresh: (() => void) | null = null;

function handleKeycloakEvent(event: string): void {
  if (event === 'onAuthSuccess') {
    stopRefresh?.();
    if (keycloak.token) {
      host.saveSettings(MINDS_ENV(keycloak.token)).then(() => {
        // After MindsHub credentials are saved, reload so App.tsx
        // re-runs its init and detects the now-configured provider.
        window.location.reload();
      }).catch(() => {});
    }
    stopRefresh = scheduleWebTokenRefresh(async (token) => {
      await host.saveSettings(MINDS_ENV(token));
    });
  } else if (event === 'onAuthLogout' || event === 'onAuthError') {
    stopRefresh?.();
    stopRefresh = null;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReactKeycloakProvider authClient={keycloak} initOptions={initOptions} onEvent={handleKeycloakEvent}>
      <App />
    </ReactKeycloakProvider>
  </StrictMode>
);
