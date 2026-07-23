import Keycloak from 'keycloak-js';
import { MINDS_KEYCLOAK_URL } from './mindsUrls';

// Single source of truth for the Keycloak host lives in mindsUrls.ts so the
// login flow and the sign-up link (MINDS_REGISTER_URL) always agree on the
// environment (prod / staging / dev).
const keycloakUrl = MINDS_KEYCLOAK_URL;

// Base URL without query params for Keycloak redirect (Keycloak validates strictly)
const redirectUri = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.host}${window.location.pathname}`
  : undefined;

// Web uses the `public-client` (browser redirect + web origins), same as the
// MindsHub console. `anton-desktop` is the loopback-only PKCE client for the
// native desktop app (redirectUris http://127.0.0.1:*) and can't serve a
// browser origin, so it must not be used here.
const keycloak = new Keycloak({
  url: keycloakUrl,
  realm: 'mindsdb',
  clientId: 'public-client',
});

keycloak.onAuthError = () => {
  keycloak.clearToken();
  keycloak.login({ redirectUri });
};

export { keycloak };

export const getAccessToken = async (): Promise<string | null> => {
  if (!keycloak.authenticated) return null;
  try {
    await keycloak.updateToken(30);
    return keycloak.token ?? null;
  } catch {
    return keycloak.token ?? null;
  }
};
