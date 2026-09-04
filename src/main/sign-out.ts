/*
 * The full MindsHub sign-out sequence.
 *
 * It lives here, behind injected dependencies, because the ordering inside it
 * is load-bearing and nothing could test it while it sat in `index.ts`, which
 * imports Electron and cannot be loaded under vitest. The steps and their
 * comments are the ones that were inline; what changed is the end of the
 * sequence. The sidecar restart used to be awaited here, which held the
 * AUTH_LOGOUT reply for as long as a restart can take and locked the confirm
 * dialog on "Signing out…" for minutes. It is now handed to
 * `sign-out-restart.ts` and left running while this resolves.
 *
 * Two things the caller supplies rather than this module deciding:
 * `startSidecarFlush`, so the restart is startable without being awaited, and
 * `reloadRenderer`, because only main can drive the one navigation.
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

/*
 * Every credential key the sidecar holds, for the fallback path below. Kept as
 * a list rather than derived, because an older server is exactly the case this
 * fallback exists for and it cannot be asked what it stores.
 */
const DB_CREDENTIAL_KEYS = [
  'minds_api_key', 'anthropic_api_key', 'openai_api_key',
  'gemini_api_key', 'openai_compatible_api_key',
  'minds_url', 'openai_base_url',
  'providers_json', 'provider_status', 'provider_status_details',
];

/*
 * True from the moment a sign-out starts until its sidecar restart has
 * settled. Boot routing reads it so the reload sign-out drives cannot land on
 * a sidecar that is still going down, read `config_ready: true` off it, and
 * route the person who just signed out back into the app. Before the reply
 * moved ahead of the restart this could not happen: the sidecar was always
 * down by the time the page reloaded.
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
  // Full sign-out: clear every credential + LLM-config key so the
  // next launch's checkConfigured() returns false and the user is
  // routed straight to onboarding. We deliberately keep
  // ANTON_TERMS_CONSENT (the user already agreed) and non-credential
  // preferences (memory mode, theme, etc.).
  //
  // We must NOT await the chain below: when the dev Keycloak hangs
  // (which has happened), a synchronous await freezes the whole
  // logout, leaving the confirm modal stuck on "Signing out…"
  // because the renderer is waiting on this IPC.
  //
  // ENG-498: revoke THIS device's key while the session is still valid,
  // then end the Keycloak session — one detached chain (see
  // revokeDeviceKeyAndEndSession for the ordering rationale). Tokens are
  // snapshotted here because clearTokens() below wipes them; the token
  // fetch is bounded (~5s) so a dead IdP can't stall sign-out, in which
  // case the key simply falls to the server-side TTL.
  const revokeAccessToken = await deps.getRevokeToken();
  // Read the refresh token only AFTER the exchange above settles: a
  // refresh inside getRevokeToken may ROTATE the persisted refresh token
  // (see its NOTE), and reading earlier would hand end-session a
  // superseded token.
  const logoutRefreshToken = deps.getRefreshToken();
  void deps.revokeDeviceKeyAndEndSession(revokeAccessToken, logoutRefreshToken);
  // Fence again after the bounded lookup. If its Keycloak request outlives the
  // timeout, this new cancellation epoch prevents the late response from
  // writing tokens after the local session is cleared below.
  deps.cancelScheduledRefresh();
  // Resolve any request already held across wake, and keep later turns blocked
  // until a new selected credential is explicitly handed over.
  deps.settleMindsResumeCredentialGate(false);
  // Take every MindsHub credential away first and await it, unlike the
  // detached revoke above. This is the step that actually stops this
  // install's turns, and the renderer treats the IPC resolving as "signed
  // out" — so a fire-and-forget push could lose the race and leave the
  // sidecar running on a live token after the UI said otherwise.
  // Best-effort like every other step below it. keychain-fallback's write is
  // unguarded, so on a machine with no OS secure store this can throw — and an
  // unguarded throw here would skip the token clear, the DB clear, the .env
  // scrub and the renderer reload, wedging the confirm modal on "Signing out…".
  try {
    await deps.forgetMindsCredential();
  } catch (err) {
    console.warn('[logout] could not clear the MindsHub credential:', err);
  }
  // Tear down any sign-in still waiting on its browser tab. Without
  // this, the loopback server stays armed for up to 3 minutes and
  // completing that stale tab silently signs the user back in after
  // an explicit logout.
  deps.cancelCurrentOAuth();
  deps.clearTokens();
  // A refresh that was already inside its awaited handoff can settle true
  // between the early barrier above and this token-store transition. Drop the
  // barrier outright rather than reasserting a blocked state: a signed-out
  // install has no resumed credential to wait for, and nothing in that state
  // can ever settle it true again. Leaving it blocked would cancel every later
  // turn, including the direct-provider turns that never touch MindsHub.
  deps.resetMindsResumeCredentialGate();

  // Clear credentials from the server's SQLite DB (the authoritative
  // source for config_ready). A single POST /settings/logout atomically
  // clears all credential keys and provider state in one transaction.
  // If the endpoint isn't available (404/405 — older server version),
  // fall back to individual DELETE requests for each credential key.
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

    // Fallback: if POST /settings/logout isn't available (404/405 on
    // older server versions that don't have the endpoint yet), clear
    // each credential key individually via DELETE. Without this, the
    // DB retains credentials and config_ready stays true after logout.
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

  // Scrub credential keys from the shared .env (see logout-env.ts). Since the
  // ENG-941 settings refactor the DB — not the .env — is authoritative for
  // credentials and config_ready: the .env→DB seed is one-time and
  // sentinel-guarded, so a restart never re-reads the .env, and the DB clear
  // above (POST /settings/logout) is what actually signs the user out. This
  // scrub is therefore best-effort hygiene: it keeps stale keys from the
  // standalone anton CLI, but a failure does NOT mean the user is still
  // signed in. scrubEnvCredentials retries transient Windows share-mode locks
  // (ENG-1209) and always clears process.env; if the write still can't land we
  // log and press on rather than fail an otherwise-complete sign-out or trap
  // the renderer's "Signing out…" spinner (the original ENG-1206 hang). The
  // renderer keeps its own recovery path for a genuinely rejected logout.
  //
  // This stays ABOVE the reload. Boot routing falls back to reading the .env
  // when it cannot reach the sidecar, so a reload that overtook this scrub
  // could read a leftover ANTON_MINDS_API_KEY and route a signed-out user
  // back into the app.
  try {
    await deps.scrubEnvCredentials(deps.getAntonEnvPath());
  } catch (err) {
    console.warn('[logout] failed to scrub credential keys from .env (best-effort):', err);
  }
  deps.clearStoredProviderState();

  // Restart the server so in-memory caches (settings, provider objects) are
  // flushed. The DB clear above already dropped the credential rows and
  // invalidated the settings cache, so config_ready is false without this —
  // the restart is belt-and-suspenders against any provider object still held
  // in memory reporting config_ready: true after the UI says "signed out".
  //
  // Started, not awaited. Everything above decides "you are signed out", and
  // the person watching the dialog has no reason to wait on a process restart
  // to be told so. `sign-out-restart.ts` owns the rest.
  deps.startSidecarFlush();

  // Force-reload the renderer from main. The renderer's own
  // `window.location.reload()` was unreliable here (page stayed on
  // the stuck confirm modal); driving the reload from the main
  // process via webContents.reload() always navigates and reboots
  // App.tsx's init() → checkConfigured() → onboarding redirect.
  //
  // Defer to the next tick so this handler's promise resolves and the
  // IPC reply is delivered to the renderer BEFORE we tear the page
  // down. Reloading synchronously here races the reply: sometimes the
  // renderer got it and also reloaded (double reload → stuck modal),
  // sometimes the page died before the reply landed. The single
  // deferred reload makes it deterministic. The renderer no longer
  // reloads on Electron (see useLogout).
  deps.reloadRenderer();
}
