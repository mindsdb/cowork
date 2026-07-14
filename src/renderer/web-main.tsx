// Web entrypoint — mounts the same gated <App /> as Electron.
//
// App.tsx runs the onboarding gates (Intro → Terms → Setup →
// Onboarding → cowork). Each gate's bridge call now goes through
// `host.*`, which routes to ~/.anton/.env via FastAPI in web and via
// window.antontron in Electron. Setup auto-completes on web (the
// FastAPI host running this code IS the install).
//
// Cloud-hosted instances (behind the Cloudflare Worker auth gate) skip
// the Keycloak wrapper entirely — the user already authenticated via
// the MindsHub dashboard, and the Worker's session cookie gates access.
// Keycloak is only needed for standalone web dev (localhost).
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
import { keycloak, scheduleWebTokenRefresh } from './lib/keycloak';
import { loadSkin } from './lib/skins';
import { host } from './platform/host';
import { syncSettingsToDb } from './lib/syncSettings';

// Cloud-hosted instances are accessed via the Cloudflare Worker, which
// already authenticates users via a session cookie minted from their
// MindsHub Keycloak JWT. The SPA doesn't need its own Keycloak login.
// Detect cloud hosting by checking if the hostname is NOT localhost/loopback.
const isCloudHosted = (() => {
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '::1';
})();

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

const cleanRedirectUri = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
const initOptions = { onLoad: 'login-required' as const, pkceMethod: 'S256', checkLoginIframe: false, redirectUri: cleanRedirectUri };

// ENG-436: write ONLY the dedicated minds slots — never the OpenAI slot.
// cowork-server resolves minds-cloud from minds_api_key/minds_url (main
// agent + scratchpad), so the OpenAI slot is no longer needed and is left
// for the user's own key. ANTON_MINDS_URL is required so the scratchpad
// derives the right host (/v1 for api.mindshub.ai) instead of falling back
// to the default mdb.ai.
const MINDS_API_HOST = import.meta.env.VITE_MINDS_API_URL || 'https://api.mindshub.ai';
const MINDS_ENV_LINES = (token: string) => [
  `ANTON_MINDS_API_KEY=${token}`,
  `ANTON_MINDS_URL=${MINDS_API_HOST}`,
];

/** Write MindsHub tokens to both .env (legacy) and the backend DB. */
async function saveMindsToken(token: string): Promise<void> {
  const lines = MINDS_ENV_LINES(token);
  await host.saveSettings(lines.join('\n'));
  await syncSettingsToDb(lines);
}

let stopRefresh: (() => void) | null = null;

function handleKeycloakEvent(event: string): void {
  if (event === 'onAuthSuccess') {
    stopRefresh?.();
    if (keycloak.token) {
      saveMindsToken(keycloak.token).then(() => {
        // After MindsHub credentials are saved, reload so App.tsx
        // re-runs its init and detects the now-configured provider.
        window.location.reload();
      }).catch(() => {});
    }
    stopRefresh = scheduleWebTokenRefresh(async (token) => {
      await saveMindsToken(token);
    });
  } else if (event === 'onAuthLogout' || event === 'onAuthError') {
    stopRefresh?.();
    stopRefresh = null;
  }
}

const root = document.getElementById('root')!;

if (isCloudHosted) {
  // Cloud: Worker session cookie is the auth gate. Render directly.
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} else {
  // Local dev: Keycloak handles auth + token refresh.
  createRoot(root).render(
    <StrictMode>
      <ReactKeycloakProvider authClient={keycloak} initOptions={initOptions} onEvent={handleKeycloakEvent}>
        <App />
      </ReactKeycloakProvider>
    </StrictMode>
  );
}
