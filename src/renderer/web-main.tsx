// Web mounts the gated App after Keycloak login; API calls carry its bearer. Legacy cw-<id> hosts
// remain upstream-authenticated and bypass the wrapper because their dynamic hostnames are not
// registered Keycloak redirect URIs. Remove that exception after migration to canonical cowork
// hosts.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactKeycloakProvider } from '@react-keycloak/web';
// Load Tailwind after legacy styles so equal-specificity ties match Electron.
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import './cowork/styles/tailwind.css';
import App from './App';
import {
  pinWebOrganizationCacheIdentity,
  requireWebOrganizationCacheIdentity,
} from './cowork/lib/organizationCacheIdentity';
import { prepareForOrganizationReload } from './cowork/lib/organizationTransition';
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

// Legacy host classification and upstream-authentication requirements live in lib/legacyHost.ts.
const legacyTenant = isLegacyTenantHost(window.location.hostname);
// Keep the Code visual-fixture bypass development-only, matching App.tsx.
const codeFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).has('codeFixture');
if (!legacyTenant && !codeFixture) requireWebOrganizationCacheIdentity();

function bindOrganizationCacheTokens(tokens: { token?: string }) {
  if (pinWebOrganizationCacheIdentity(tokens.token) === 'changed') {
    prepareForOrganizationReload();
  }
}

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    {legacyTenant || codeFixture ? (
      // Access is gated upstream; render directly without a Keycloak login.
      <App />
    ) : (
      // Wait for Keycloak initialization before App probes health; an early bearer-free probe would
      // route a signed-in user back to auth.
      <ReactKeycloakProvider
        authClient={keycloak}
        initOptions={initOptions}
        LoadingComponent={<div style={{ width: '100vw', height: '100vh' }} />}
        onTokens={bindOrganizationCacheTokens}
      >
        <App />
      </ReactKeycloakProvider>
    )}
  </StrictMode>
);
