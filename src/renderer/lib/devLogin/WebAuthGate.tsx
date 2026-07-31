// Single decision point for how the web SPA authenticates. Wraps <App/> and,
// depending on build/runtime flags (see resolveWebAuthMode), either runs the
// real Keycloak login redirect (production), mounts the app with no auth
// (local dev default), or drives a local ROPC dev-login (VITE_DEV_LOGIN=true).
//
// The non-production branches are only reachable under `vite dev`
// (import.meta.env.DEV), which is compile-time `false` in `build:web`, so a
// deployed bundle always takes the production path.

import { ReactKeycloakProvider } from '@react-keycloak/web';
import { useRef, useState, type ReactNode } from 'react';

import { keycloak } from '../keycloak';
import DevLoginForm from './DevLoginForm';
import {
  getStoredDevTokens,
  patchKeycloakForDev,
  type DevTokens,
} from './devAuth';
import { resolveWebAuthMode } from './webAuthMode';

const REALM = 'mindsdb';
const CLIENT_ID = 'public-client';

// Same-origin, proxied through the Vite `/auth` rule (see vite.config.ts) so
// the ROPC token call isn't blocked by Keycloak CORS on localhost.
const TOKEN_ENDPOINT = `/auth/realms/${REALM}/protocol/openid-connect/token`;

const IS_DEV = import.meta.env.DEV;
const DEV_LOGIN_ENABLED =
  (import.meta.env as Record<string, unknown>).VITE_DEV_LOGIN === 'true';

// Base URL without query params — Keycloak validates redirect URIs strictly.
function cleanRedirectUri(): string {
  const { protocol, host, pathname } = window.location;
  return `${protocol}//${host}${pathname}`;
}

export default function WebAuthGate({ children }: { children: ReactNode }) {
  const [devTokens, setDevTokens] = useState<DevTokens | null>(() =>
    IS_DEV && DEV_LOGIN_ENABLED ? getStoredDevTokens() : null,
  );
  const patched = useRef(false);

  const mode = resolveWebAuthMode({
    isDev: IS_DEV,
    devLoginEnabled: DEV_LOGIN_ENABLED,
    hasStoredTokens: !!devTokens,
  });

  // Dev default: no auth wrapper at all. The local cowork-server ignores the
  // absent Bearer; getAccessToken() returns null (keycloak.authenticated false).
  if (mode === 'skip') {
    return <>{children}</>;
  }

  // Dev + VITE_DEV_LOGIN, no cached token → collect credentials via ROPC.
  if (mode === 'dev-login-form') {
    return (
      <DevLoginForm
        clientId={CLIENT_ID}
        tokenEndpoint={TOKEN_ENDPOINT}
        onSuccess={setDevTokens}
      />
    );
  }

  // Dev + VITE_DEV_LOGIN with a cached token → patch the singleton once so
  // ReactKeycloakProvider mounts as authenticated (no redirect).
  if (mode === 'dev-login-ready') {
    if (!patched.current && devTokens) {
      patchKeycloakForDev(
        keycloak,
        { clientId: CLIENT_ID, realm: REALM, tokenEndpoint: TOKEN_ENDPOINT },
        devTokens,
      );
      patched.current = true;
    }
    return (
      <ReactKeycloakProvider
        authClient={keycloak}
        initOptions={{ checkLoginIframe: false }}
      >
        {children}
      </ReactKeycloakProvider>
    );
  }

  // Production: unchanged login-required redirect.
  return (
    <ReactKeycloakProvider
      authClient={keycloak}
      initOptions={{
        onLoad: 'login-required',
        pkceMethod: 'S256',
        checkLoginIframe: false,
        redirectUri: cleanRedirectUri(),
      }}
    >
      {children}
    </ReactKeycloakProvider>
  );
}
