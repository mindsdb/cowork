// Dev-mode auth helpers for `npm run dev:web` with VITE_DEV_LOGIN=true.
//
// These monkey-patch the keycloak-js singleton so ReactKeycloakProvider mounts
// without any real Keycloak server interaction (discovery, SSO check, browser
// redirect). Tokens come from Keycloak's Resource Owner Password Credentials
// (ROPC / Direct Grant) flow via a direct fetch to the token endpoint, proxied
// through the Vite dev server (see the `/auth` proxy in vite.config.ts).
//
// Ported from mindshub_frontend's src/components/devLogin/devAuth.js so the two
// web apps share one dev-login story against the same Keycloak realms.

import type Keycloak from 'keycloak-js';

export const DEV_AUTH_STORAGE_KEY = '_dev_auth_tokens';

export interface DevTokens {
  token: string;
  refreshToken?: string;
  idToken?: string;
}

/** Base64url-decode the payload section of a JWT. Returns null on any error. */
export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * Set ROPC tokens directly on the keycloak instance so every consumer
 * (getAccessToken, keycloak.authenticated reads, ReactKeycloakProvider) sees
 * the correct values.
 */
export function applyDevTokens(keycloak: Keycloak, tokens: DevTokens): void {
  keycloak.token = tokens.token;
  keycloak.refreshToken = tokens.refreshToken;
  keycloak.idToken = tokens.idToken;
  keycloak.authenticated = true;

  keycloak.tokenParsed = decodeJwtPayload(tokens.token) ?? undefined;
  keycloak.idTokenParsed = tokens.idToken
    ? decodeJwtPayload(tokens.idToken) ?? undefined
    : undefined;

  if (keycloak.tokenParsed) {
    keycloak.subject = keycloak.tokenParsed.sub;
    keycloak.realmAccess = keycloak.tokenParsed.realm_access;
    keycloak.resourceAccess = keycloak.tokenParsed.resource_access;
  }
}

/** Refresh the ROPC tokens via a direct fetch to the (proxied) token endpoint. */
async function refreshDevTokens(
  keycloak: Keycloak,
  tokenEndpoint: string,
  clientId: string,
): Promise<void> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: keycloak.refreshToken ?? '',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status})`);
  }

  const data = await res.json();
  const newTokens: DevTokens = {
    token: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
  };

  applyDevTokens(keycloak, newTokens);
  localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(newTokens));
}

/** Read cached ROPC tokens from localStorage (returns null if absent/invalid). */
export function getStoredDevTokens(): DevTokens | null {
  try {
    const stored = localStorage.getItem(DEV_AUTH_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as DevTokens) : null;
  } catch {
    return null;
  }
}

/** Remove cached ROPC tokens from localStorage. */
export function clearDevTokens(): void {
  localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
}

export interface PatchOptions {
  clientId: string;
  realm: string;
  tokenEndpoint: string;
}

/**
 * Monkey-patch `keycloak.init`, `.updateToken`, and `.logout` so
 * ReactKeycloakProvider mounts normally without any real Keycloak interaction.
 */
export function patchKeycloakForDev(
  keycloak: Keycloak,
  { clientId, realm, tokenEndpoint }: PatchOptions,
  tokens: DevTokens,
): void {
  applyDevTokens(keycloak, tokens);

  // Config properties keycloak.init() would normally set; some callers read
  // keycloak.realm to build request URLs.
  keycloak.realm = realm;
  keycloak.clientId = clientId;

  // Skip real initialization entirely, but still fire the callbacks
  // ReactKeycloakProvider wires up so it transitions to "ready".
  keycloak.init = () => {
    setTimeout(() => {
      keycloak.onAuthSuccess?.();
      keycloak.onReady?.(true);
    }, 0);
    return Promise.resolve(true);
  };

  keycloak.updateToken = async (minValidity = 5) => {
    if (!keycloak.tokenParsed?.exp) return false;

    const expiresAt = keycloak.tokenParsed.exp * 1000;
    const threshold = minValidity * 1000;
    if (expiresAt - Date.now() > threshold) {
      return false; // still valid — no refresh performed
    }

    await refreshDevTokens(keycloak, tokenEndpoint, clientId);
    return true;
  };

  keycloak.logout = () => {
    clearDevTokens();
    keycloak.authenticated = false;
    keycloak.token = undefined;
    keycloak.refreshToken = undefined;
    keycloak.idToken = undefined;
    window.location.reload();
    return Promise.resolve();
  };
}
