// Sign-in inside the mobile app (ENG-4023): a keycloak-js adapter that opens
// Keycloak in the system browser sheet instead of navigating the webview.
//
// Why the sheet: the webview is not a real browser, so Google sign-in refuses
// it and the user's MindsHub session would not be shared. ASWebAuthenticationSession
// (iOS) and Custom Tabs (Android) are, and they return to the app through the
// `ai.mindshub.cowork://auth/callback` redirect. Same Keycloak PKCE flow and
// the same sign-in and sign-up pages as desktop and web.
//
// How it fits keycloak-js 26 (lib/keycloak.js):
//   1. `createLoginUrl` / `createRegisterUrl` (async) build the authorize URL
//      and store `{ state, nonce, redirectUri, pkceCodeVerifier }` in callback
//      storage (localStorage, `kc-callback-<state>`). The adapter passes the
//      app's redirect URI, so that is what gets stored and sent.
//   2. The native `MindsHubAuth.authenticate` plugin opens that URL and
//      resolves with the URL Keycloak redirected to.
//   3. keycloak-js has no public "process this callback URL" call: `init()`
//      reads the callback from `window.location.href` (fragment by default,
//      per `responseMode`). So the adapter copies the callback's OAuth params
//      onto this page's URL and reloads. On reload `init()` finds the state in
//      storage and exchanges the code with the stored verifier and redirect
//      URI, which match the authorize request exactly.

import type { KeycloakAdapter, KeycloakLoginOptions, KeycloakLogoutOptions } from 'keycloak-js';

/** The Keycloak client for the app: public, PKCE, app-scheme redirect. */
export const MOBILE_KEYCLOAK_CLIENT_ID = 'cowork-mobile';
export const MOBILE_AUTH_CALLBACK_SCHEME = 'ai.mindshub.cowork';
export const MOBILE_AUTH_REDIRECT_URI = `${MOBILE_AUTH_CALLBACK_SCHEME}://auth/callback`;

/** The native sign-in plugin the shell registers as `Capacitor.Plugins.MindsHubAuth`. */
export interface MindsHubAuthPlugin {
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

/** The parameters keycloak-js reads from a callback (standard flow), plus errors. */
export const OAUTH_CALLBACK_PARAMS = [
  'code',
  'state',
  'session_state',
  'iss',
  'kc_action_status',
  'kc_action',
  'error',
  'error_description',
  'error_uri',
] as const;

/** The MindsHubAuth plugin, or null when the shell did not provide it. */
export function getMindsHubAuthPlugin(win: unknown = typeof window !== 'undefined' ? window : undefined): MindsHubAuthPlugin | null {
  const plugin = (win as { Capacitor?: { Plugins?: { MindsHubAuth?: unknown } } } | undefined)
    ?.Capacitor?.Plugins?.MindsHubAuth;
  return plugin && typeof (plugin as MindsHubAuthPlugin).authenticate === 'function'
    ? plugin as MindsHubAuthPlugin
    : null;
}

/** True when the user closed the sign-in sheet. */
export function isAuthCancelled(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'CANCELLED';
}

/**
 * The OAuth params of a callback URL, from its query and its fragment (the
 * fragment wins). Only the params keycloak-js reads are kept. Null unless it
 * carries a state and either a code or an error, the same test keycloak-js
 * applies before it treats a URL as a callback.
 */
export function extractCallbackParams(callbackUrl: string): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }
  const found = new Map<string, string>();
  for (const source of [url.search.slice(1), url.hash.slice(1)]) {
    for (const [key, value] of new URLSearchParams(source)) {
      if ((OAUTH_CALLBACK_PARAMS as readonly string[]).includes(key)) found.set(key, value);
    }
  }
  if (!found.get('state') || !(found.get('code') || found.get('error'))) return null;
  const params = new URLSearchParams();
  for (const key of OAUTH_CALLBACK_PARAMS) {
    const value = found.get(key);
    if (value !== undefined) params.set(key, value);
  }
  return params;
}

/**
 * This page's URL carrying the callback params where keycloak-js's `init()`
 * looks for them: the fragment by default, the query for responseMode 'query'.
 */
export function buildCallbackReplayUrl(
  currentHref: string,
  params: URLSearchParams,
  responseMode: 'fragment' | 'query' = 'fragment',
): string {
  const url = new URL(currentHref);
  url.hash = '';
  if (responseMode === 'query') {
    for (const [key, value] of params) url.searchParams.set(key, value);
  } else {
    url.hash = params.toString();
  }
  return url.toString();
}

/** What the adapter needs from the Keycloak instance. */
export interface MobileAdapterKeycloak {
  createLoginUrl(options?: KeycloakLoginOptions): Promise<string>;
  createRegisterUrl(options?: KeycloakLoginOptions): Promise<string>;
  clearToken(): void;
  refreshToken?: string;
  responseMode?: 'fragment' | 'query';
  clientId?: string;
}

export interface MobileAdapterDeps {
  keycloak: MobileAdapterKeycloak;
  /** The realm's end-session endpoint. */
  logoutUrl: string;
  getPlugin?: () => MindsHubAuthPlugin | null;
  currentHref?: () => string;
  /** Put the callback on this page's URL and reload, so init() processes it. */
  replayCallback?: (url: string) => void;
  /** Leave the page after sign-out. */
  navigate?: (url: string) => void;
  fetch?: typeof fetch;
  logoutTimeoutMs?: number;
  /**
   * Runs first on sign-out, while the tokens are still valid (the mobile app
   * removes this phone's push token from the user, lib/mobilePush.ts).
   * Best effort: bounded by `beforeLogoutTimeoutMs`, and a failure never
   * stops the sign-out.
   */
  beforeLogout?: () => Promise<void>;
  beforeLogoutTimeoutMs?: number;
}

/** Wait for `task`, at most `ms`; never rejects. */
async function settleWithin(task: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(task),
      new Promise<void>((resolve) => { timer = globalThis.setTimeout(resolve, ms); }),
    ]);
  } catch {
    // Signing out anyway.
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function defaultReplayCallback(url: string): void {
  // Changing only the fragment would not reload the page, so set the URL
  // without navigating and reload explicitly.
  window.history.replaceState(window.history.state, '', url);
  window.location.reload();
}

function appRoot(): string {
  return `${window.location.origin}/`;
}

/**
 * The keycloak-js adapter for the app. Sign-in and sign-up open the system
 * browser sheet; closing the sheet resolves quietly, so the sign-in screen
 * stays put. Sign-out ends the Keycloak session with the refresh token, then
 * clears the tokens and reloads to the sign-in screen.
 */
export function createMobileShellAdapter(deps: MobileAdapterDeps): KeycloakAdapter {
  const {
    keycloak,
    logoutUrl,
    getPlugin = () => getMindsHubAuthPlugin(),
    currentHref = () => window.location.href,
    replayCallback = defaultReplayCallback,
    navigate = (url: string) => window.location.replace(url),
    fetch: fetchImpl = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    logoutTimeoutMs = 5_000,
    beforeLogout,
    beforeLogoutTimeoutMs = 3_000,
  } = deps;

  const runNativeFlow = async (createUrl: () => Promise<string>): Promise<void> => {
    const plugin = getPlugin();
    if (!plugin) throw new Error('Sign-in is not available in this version of the app.');
    const url = await createUrl();
    let result: { url: string };
    try {
      result = await plugin.authenticate({ url, callbackScheme: MOBILE_AUTH_CALLBACK_SCHEME });
    } catch (error) {
      if (isAuthCancelled(error)) return;
      throw error;
    }
    const params = extractCallbackParams(result?.url ?? '');
    if (!params) throw new Error('Sign-in did not finish. Please try again.');
    replayCallback(buildCallbackReplayUrl(currentHref(), params, keycloak.responseMode ?? 'fragment'));
  };

  return {
    // Whatever redirect a caller asked for (keycloak.ts passes the web page's),
    // the app's authorize request must name the app's redirect URI.
    login: (options?: KeycloakLoginOptions) => runNativeFlow(
      () => keycloak.createLoginUrl({ ...options, redirectUri: MOBILE_AUTH_REDIRECT_URI }),
    ),
    register: (options?: KeycloakLoginOptions) => runNativeFlow(
      () => keycloak.createRegisterUrl({ ...options, redirectUri: MOBILE_AUTH_REDIRECT_URI }),
    ),
    logout: async (options?: KeycloakLogoutOptions) => {
      // Before anything invalidates the tokens: the hook may call the API.
      if (beforeLogout) await settleWithin(beforeLogout, beforeLogoutTimeoutMs);
      // The Keycloak session cookie lives in the system browser, not this
      // webview, so a redirect logout here would not reach it. Ending the
      // session with the refresh token does (it kills the server-side session
      // the cookie points at), so the next sign-in asks for credentials again.
      // A failure still signs out locally: a stuck sign-out is worse.
      const refreshToken = keycloak.refreshToken;
      if (refreshToken && keycloak.clientId) {
        const controller = new AbortController();
        const timeout = globalThis.setTimeout(() => controller.abort(), logoutTimeoutMs);
        try {
          await fetchImpl(logoutUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: keycloak.clientId, refresh_token: refreshToken }),
            signal: controller.signal,
          });
        } catch {
          // Signed out locally below either way.
        } finally {
          globalThis.clearTimeout(timeout);
        }
      }
      keycloak.clearToken();
      navigate(options?.redirectUri ?? appRoot());
    },
    accountManagement: async () => {
      throw new Error('Account management is not available in the app.');
    },
    redirectUri: (options) => options?.redirectUri ?? MOBILE_AUTH_REDIRECT_URI,
  };
}

/**
 * Options for `keycloak.init`. Outside the app this is exactly the web
 * options: log in on load, by redirect. Inside the app there is no `onLoad`,
 * which would open the sheet the moment the app starts; the app shows its own
 * sign-in screen instead, and the adapter handles the rest.
 */
export function keycloakInitOptions(redirectUri: string, mobileAdapter: KeycloakAdapter | null | undefined) {
  if (!mobileAdapter) {
    return { onLoad: 'login-required' as const, pkceMethod: 'S256' as const, checkLoginIframe: false, redirectUri };
  }
  // ReactKeycloakProvider merges in onLoad: 'check-sso'. Explicit undefined
  // overrides that default; merely omitting it opens the native sheet on mount.
  return { onLoad: undefined, pkceMethod: 'S256' as const, checkLoginIframe: false, adapter: mobileAdapter };
}
