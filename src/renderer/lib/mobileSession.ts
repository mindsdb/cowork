// Keeps the mobile app signed in across launches.
//
// keycloak-js holds tokens in memory, so without this every launch shows the
// sign-in screen. The app saves the current tokens in the phone's secure
// storage (iOS Keychain, Android Keystore) through the native MindsHubAuth
// plugin, and restores them at launch before Keycloak initializes.
//
// The refresh token is bound to the Keycloak SSO session, so the realm's
// session limits decide how long someone stays signed in. Sign-out, and any
// sign-in Keycloak refuses, clears the saved session.

/** The tokens keycloak-js needs to start signed in. */
export interface StoredSession {
  token: string;
  refreshToken: string;
  idToken?: string;
}

/** The session methods of the native MindsHubAuth plugin. */
export interface MobileSessionStore {
  loadSession(): Promise<{ session?: string | null }>;
  saveSession(options: { session: string }): Promise<void>;
  clearSession(): Promise<void>;
}

/** The plugin's session methods, or null in a shell that predates them. */
export function getMobileSessionStore(
  win: unknown = typeof window !== 'undefined' ? window : undefined,
): MobileSessionStore | null {
  const plugin = (win as { Capacitor?: { Plugins?: { MindsHubAuth?: Partial<MobileSessionStore> } } } | undefined)
    ?.Capacitor?.Plugins?.MindsHubAuth;
  return plugin
    && typeof plugin.loadSession === 'function'
    && typeof plugin.saveSession === 'function'
    && typeof plugin.clearSession === 'function'
    ? plugin as MobileSessionStore
    : null;
}

function parseSession(raw: string | null | undefined): StoredSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof value.token !== 'string' || typeof value.refreshToken !== 'string') return null;
    return {
      token: value.token,
      refreshToken: value.refreshToken,
      ...(typeof value.idToken === 'string' ? { idToken: value.idToken } : {}),
    };
  } catch {
    return null;
  }
}

/** Save the tokens. Best effort: a failed save only costs the next launch a sign-in. */
export async function saveMobileSession(
  store: MobileSessionStore | null,
  tokens: { token?: string; refreshToken?: string; idToken?: string },
): Promise<void> {
  if (!store || !tokens.token || !tokens.refreshToken) return;
  const session: StoredSession = { token: tokens.token, refreshToken: tokens.refreshToken };
  if (tokens.idToken) session.idToken = tokens.idToken;
  try {
    await store.saveSession({ session: JSON.stringify(session) });
  } catch {
    // Signed in for this launch either way.
  }
}

/** Forget the saved session. Never rejects. */
export async function clearMobileSession(store: MobileSessionStore | null): Promise<void> {
  if (!store) return;
  try {
    await store.clearSession();
  } catch {
    // Nothing more to do: a session that can't be cleared can't be read either.
  }
}

export type RestoreResult =
  /** A saved session that Keycloak just refreshed: start signed in with these. */
  | { kind: 'restored'; session: StoredSession }
  /** Nothing saved, or Keycloak refused it (the saved session is now cleared). */
  | { kind: 'none' }
  /** Keycloak could not be reached. The saved session is kept for the next try. */
  | { kind: 'unavailable' };

export interface RestoreDeps {
  store: MobileSessionStore | null;
  /** The realm's token endpoint. */
  tokenUrl: string;
  clientId: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Restore the saved session, if there is one, by refreshing it once.
 *
 * Refreshing here, rather than leaving it to keycloak-js, tells a session
 * Keycloak refused (cleared, so the app shows sign-in) apart from a network
 * failure (kept, so a flaky connection at launch doesn't sign anyone out).
 * keycloak-js reports both as the same init error.
 */
export async function restoreMobileSession(deps: RestoreDeps): Promise<RestoreResult> {
  const {
    store,
    tokenUrl,
    clientId,
    fetch: fetchImpl = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    timeoutMs = 10_000,
  } = deps;
  if (!store) return { kind: 'none' };

  let saved: StoredSession | null;
  try {
    saved = parseSession((await store.loadSession())?.session);
  } catch {
    return { kind: 'none' };
  }
  if (!saved) return { kind: 'none' };

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: saved.refreshToken }),
      signal: controller.signal,
    });
  } catch {
    return { kind: 'unavailable' };
  } finally {
    globalThis.clearTimeout(timeout);
  }

  // 400 invalid_grant (expired, revoked, signed out elsewhere) or 401: the
  // session is gone for good.
  if (response.status === 400 || response.status === 401) {
    await clearMobileSession(store);
    return { kind: 'none' };
  }
  if (!response.ok) return { kind: 'unavailable' };

  let body: { access_token?: unknown; refresh_token?: unknown; id_token?: unknown };
  try {
    body = await response.json();
  } catch {
    return { kind: 'unavailable' };
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    return { kind: 'unavailable' };
  }
  const session: StoredSession = {
    token: body.access_token,
    refreshToken: body.refresh_token,
    ...(typeof body.id_token === 'string'
      ? { idToken: body.id_token }
      : saved.idToken ? { idToken: saved.idToken } : {}),
  };
  await saveMobileSession(store, session);
  return { kind: 'restored', session };
}
