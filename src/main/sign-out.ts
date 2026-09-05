/*
 * Clear credentials before replying, then let sign-out-restart.ts finish the sidecar flush.
 * Main supplies the restart and renderer reload; the sequence stays testable without Electron.
 */

export type SignOutHttpRequest = (
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string; rejectUnauthorized?: boolean },
) => Promise<{ status: number; body: string }>;

export interface SignOutDeps {
  // Keycloak session and token store.
  getRevokeToken: () => Promise<string | null>;
  getRefreshToken: () => string | null;
  revokeDeviceKeyAndEndSession: (accessToken: string | null, refreshToken: string | null) => Promise<void>;
  cancelScheduledRefresh: () => void;
  cancelCurrentOAuth: () => void;
  clearTokens: () => void;
  // The MindsHub credential and the gate that holds turns while it moves.
  settleMindsResumeCredentialGate: (ready: boolean) => void;
  resetMindsResumeCredentialGate: () => void;
  forgetMindsCredential: () => Promise<void>;
  // The sidecar's own credential rows.
  isServerRunning: () => boolean;
  isServerStarting: () => boolean;
  getServerPort: () => number;
  httpRequest: SignOutHttpRequest;
  // Local files.
  scrubEnvCredentials: (envPath: string) => Promise<void>;
  getAntonEnvPath: () => string;
  clearStoredProviderState: () => void;
  // The two steps that must not be awaited here.
  startSidecarFlush: () => void;
  reloadRenderer: () => void;
}

/* Keep an explicit fallback key list because older sidecars cannot report their credential schema. */
const DB_CREDENTIAL_KEYS = [
  'minds_api_key', 'anthropic_api_key', 'openai_api_key',
  'gemini_api_key', 'openai_compatible_api_key',
  'minds_url', 'openai_base_url',
  'providers_json', 'provider_status', 'provider_status_details',
];

/*
 * Keep boot routing unconfigured until sign-out’s restart settles; an outgoing sidecar may still
 * report ready.
 */
let signOutRouting = false;

export function beginSignOutRouting(): void {
  signOutRouting = true;
}

export function endSignOutRouting(): void {
  signOutRouting = false;
}

export function isSignOutRoutingActive(): boolean {
  return signOutRouting;
}

export async function performSignOutCleanup(deps: SignOutDeps): Promise<void> {
  // Keep consent and non-credential preferences. Snapshot tokens before clearing them, then revoke
  // device keys
  // and end the IdP session in a detached, bounded chain so remote failure cannot hold the sign-out
  // reply.
  const revokeAccessToken = await deps.getRevokeToken();
  // Read the refresh token after getRevokeToken because that exchange may rotate it.
  const logoutRefreshToken = deps.getRefreshToken();
  void deps.revokeDeviceKeyAndEndSession(revokeAccessToken, logoutRefreshToken);
  // Fence again after the bounded lookup so a late exchange cannot write tokens after local
  // clearing.
  deps.cancelScheduledRefresh();
  // Resolve any request already held across wake, and keep later turns blocked
  // until a new selected credential is explicitly handed over.
  deps.settleMindsResumeCredentialGate(false);
  // Await credential removal before reporting sign-out, including the sidecar clear.
  // Catch storage failures so remaining token/DB/env cleanup and renderer reload still run.
  try {
    await deps.forgetMindsCredential();
  } catch (err) {
    console.warn('[logout] could not clear the MindsHub credential:', err);
  }
  // Cancel pending browser sign-in so an old callback cannot silently sign the user back in.
  deps.cancelCurrentOAuth();
  deps.clearTokens();
  // Drop the wake barrier after sign-out; leaving it blocked would also prevent later
  // direct-provider turns.
  deps.resetMindsResumeCredentialGate();

  // Clear DB credentials atomically; fall back to per-key deletes only for older servers returning
  // 404/405.
  let dbCleared = false;
  if (deps.isServerRunning() || deps.isServerStarting()) {
    const port = deps.getServerPort();
    try {
      const res = await Promise.race([
        deps.httpRequest(`http://127.0.0.1:${port}/api/v1/settings/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('logout request timed out')), 5000),
        ),
      ]);
      dbCleared = res.status >= 200 && res.status < 300;
      if (!dbCleared) console.warn('[logout] POST /settings/logout returned', res.status);
    } catch (err) {
      console.warn('[logout] POST /settings/logout failed:', err);
    }

    if (!dbCleared) {
      console.log('[logout] falling back to individual DELETE requests');
      const deletes = DB_CREDENTIAL_KEYS.map((key) =>
        deps.httpRequest(`http://127.0.0.1:${port}/api/v1/settings/${key}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => { /* best effort */ }),
      );
      await Promise.race([
        Promise.allSettled(deletes),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  }

  // Scrub .env before reload so offline boot routing cannot read a leftover key.
  // The DB clear is authoritative; log scrub failures and continue while process.env is always
  // cleared.
  try {
    await deps.scrubEnvCredentials(deps.getAntonEnvPath());
  } catch (err) {
    console.warn('[logout] failed to scrub credential keys from .env (best-effort):', err);
  }
  deps.clearStoredProviderState();

  // Start the background restart to flush provider objects; credentials are already cleared before
  // this point.
  deps.startSidecarFlush();

  // Reload once from main on the next tick so the IPC reply reaches the renderer before teardown.
  deps.reloadRenderer();
}
