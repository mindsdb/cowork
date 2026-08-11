// Web entrypoint. Mounts the same gated <App /> as Electron.
//
// App.tsx runs the onboarding gates (Intro, Terms, Setup, Onboarding, cowork).
// Each gate's bridge call goes through `host.*`, which routes to ~/.anton/.env
// via FastAPI in web and via window.antontron in Electron. Setup auto-completes
// on web (the FastAPI host running this code IS the install).
//
// Auth: canonical web instances require a Keycloak login (onLoad
// 'login-required'), same as the MindsHub console (mindshub_frontend). An
// unauthenticated visitor is redirected to Keycloak before <App /> mounts; the
// resulting token rides as `Authorization: Bearer` on every /api call (see
// host.ts / cowork/api.js), which the ingress auth subrequest validates.
//
// TRANSITION EXCEPTION — legacy per-user hosts (cw-<id>.<env>.mindshub.ai):
// these predate the k8s multitenant deployment and are gated upstream (Worker /
// ingress) rather than by the SPA's own Keycloak login. They were never
// registered as Keycloak redirect URIs, and Keycloak (26.5) cannot
// subdomain-wildcard a dynamic per-user host, so the onLoad:'login-required'
// that #473 applied to ALL hosts (when it retired the isCloudHosted bypass)
// breaks them with "Invalid parameter: redirect_uri". Skip the Keycloak wrapper
// on cw-<id> hosts — restoring their pre-#473 behaviour — until they are
// migrated onto cowork.<env>.mindshub.ai, at which point delete this branch.
//
// Same as main.tsx:
//   - First-paint theme bootstrap (avoids palette flash).
//   - Tailwind + cowork tokens loaded in the same order.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactKeycloakProvider } from '@react-keycloak/web';
// Order matters: globals/skin/styles first, Tailwind utilities LAST so
// utilities win equal-specificity ties against legacy classes — matching
// the Electron bundle, where the App-subtree CSS imports execute before
// main.tsx's tailwind.css import. Before this reorder the web bundle had
// the opposite tie-resolution from Electron for every migrated component.
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import './cowork/styles/tailwind.css';
import App from './App';
import { keycloak } from './lib/keycloak';
import { isLegacyTenantHost } from './lib/legacyHost';
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

// Legacy per-user host (cw-<id>): canonical `cowork.*` and localhost dev are
// unaffected — see the TRANSITION EXCEPTION note above and lib/legacyHost.ts.
const legacyTenant = isLegacyTenantHost(window.location.hostname);

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    {legacyTenant ? (
      // Access is gated upstream; render directly without a Keycloak login.
      <App />
    ) : (
      // LoadingComponent holds the mount until keycloak.init() resolves. Without
      // it the provider renders App immediately, App's boot effect probes
      // /api/v1/health before `authenticated` is set, getAccessToken() returns
      // null so no Bearer is attached, the auth ingress 401s the probe, and
      // resolveBootTarget lands a signed-in user on the auth screen.
      <ReactKeycloakProvider
        authClient={keycloak}
        initOptions={initOptions}
        LoadingComponent={<div style={{ width: '100vw', height: '100vh' }} />}
      >
        <App />
      </ReactKeycloakProvider>
    )}
  </StrictMode>
);
