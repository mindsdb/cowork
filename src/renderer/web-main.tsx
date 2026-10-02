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

import { StrictMode, useEffect, useState } from 'react';
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
import {
  pinWebOrganizationCacheIdentity,
  requireWebOrganizationCacheIdentity,
} from './cowork/lib/organizationCacheIdentity';
import {
  assertOrganizationTransitionClear,
  prepareForOrganizationReload,
} from './cowork/lib/organizationTransition';
import { captureConsoleHandoff } from './cowork/lib/consoleHandoff';
import { keycloak } from './lib/keycloak';
import { isLegacyTenantHost } from './lib/legacyHost';
import { loadSkin } from './lib/skins';
import { OrganizationReloadGate } from './OrganizationReloadGate';
import { RootErrorBoundary } from './RootErrorBoundary';
import { WelcomeLoading, WelcomeNotice, applyArcadePreset } from './WelcomeLoading';

(() => {
  let theme: 'light' | 'dark' = 'dark';
  try {
    const saved = window.localStorage.getItem('anton.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {}
  document.body.dataset.theme = theme;
  document.body.dataset.skin = loadSkin();
  document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
  applyArcadePreset(document.body.dataset.skin);
})();

// Before the redirect below drops the query string: a console link's
// ?from=console&mode=…&sample=… has to outlive the Keycloak round trip.
captureConsoleHandoff();

// Base URL without query params. Keycloak validates redirect URIs strictly.
const cleanRedirectUri = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
const initOptions = { onLoad: 'login-required' as const, pkceMethod: 'S256', checkLoginIframe: false, redirectUri: cleanRedirectUri };

// Legacy per-user host (cw-<id>): canonical `cowork.*` and localhost dev are
// unaffected — see the TRANSITION EXCEPTION note above and lib/legacyHost.ts.
const legacyTenant = isLegacyTenantHost(window.location.hostname);
// Match App.tsx's development-only Code fixture bypass. Keeping this outside
// production builds gives visual QA a browser-renderable surface without ever
// weakening the canonical web app's Keycloak gate.
const codeFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).has('codeFixture');
if (!legacyTenant && !codeFixture) requireWebOrganizationCacheIdentity();

function bindOrganizationCacheTokens(tokens: { token?: string }) {
  if (pinWebOrganizationCacheIdentity(tokens.token) === 'changed') {
    prepareForOrganizationReload();
  }
}

const FOCUS_TOKEN_REFRESH_INTERVAL_MS = 60_000;

/**
 * Force a token refresh when the tab comes back into view, at most once a
 * minute. A switch made outside Cowork writes no transition marker, so this
 * tab only learns of it from a refreshed token, which onTokens then rejects.
 */
function useFocusTokenRefresh() {
  useEffect(() => {
    let lastRefreshAt: number | null = null;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || !keycloak.authenticated) return;
      const now = Date.now();
      if (lastRefreshAt !== null && now - lastRefreshAt < FOCUS_TOKEN_REFRESH_INTERVAL_MS) return;
      lastRefreshAt = now;
      try {
        assertOrganizationTransitionClear();
      } catch (error) {
        console.warn('[organization] focus token refresh skipped', error);
        return;
      }
      keycloak.updateToken(-1).catch((error: unknown) => {
        console.warn('[organization] focus token refresh failed', error);
      });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
}

/**
 * Holds the App mount until keycloak.init() resolves, and offers a reload when
 * it rejects. Without LoadingComponent the provider renders App immediately,
 * App's boot effect probes /api/v1/health before `authenticated` is set,
 * getAccessToken() returns null so no Bearer is attached, the auth ingress 401s
 * the probe, and resolveBootTarget lands a signed-in user on the auth screen.
 *
 * The provider sits outside StrictMode: it calls init() from componentDidMount
 * with no unmount cleanup, so a dev double mount would call init() twice, and
 * keycloak-js rejects a second init() on one instance.
 */
function KeycloakGate() {
  const [initFailed, setInitFailed] = useState(false);
  useFocusTokenRefresh();
  const loading = initFailed ? (
    <WelcomeNotice
      title="Couldn't sign you in"
      message="We couldn't reach the sign in service. Check your connection, then reload."
      actionLabel="Reload"
      onAction={() => window.location.reload()}
    />
  ) : (
    <WelcomeLoading />
  );
  return (
    <ReactKeycloakProvider
      authClient={keycloak}
      initOptions={initOptions}
      LoadingComponent={loading}
      onEvent={(event, error) => {
        if (event !== 'onInitError') return;
        console.error('[auth] Keycloak init failed', error);
        setInitFailed(true);
      }}
      onTokens={bindOrganizationCacheTokens}
    >
      <StrictMode>
        <OrganizationReloadGate>
          <RootErrorBoundary>
            <App />
          </RootErrorBoundary>
        </OrganizationReloadGate>
      </StrictMode>
    </ReactKeycloakProvider>
  );
}

const root = document.getElementById('root')!;

createRoot(root).render(
  legacyTenant || codeFixture ? (
    // Access is gated upstream; render directly without a Keycloak login.
    <StrictMode>
      <OrganizationReloadGate>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </OrganizationReloadGate>
    </StrictMode>
  ) : (
    <KeycloakGate />
  )
);
