import { saveTokens, getRefreshToken, clearTokens, getTokenStoreVersion, getAccessToken, isAccessTokenExpired } from './token-store';
import { stopServer, startServer, isServerRunning, isServerStarting, getServerPort } from './server-process';
import { checkInstallStatus } from './installer';
import { coworkHome, coworkEnvPath, coworkStatePath } from './cowork-home';
import { getInstallationId } from './installation-id';
import { authHeader } from './server-auth';
import { hasUserSuppliedMindsCredential, isMindsCredentialSidecarReachable, syncMindsCredential, syncMindsCredentialSelection, syncUsableMindsCredential } from './minds-credential';
import { beginMindsResumeCredentialGate, settleMindsResumeCredentialGate } from './minds-resume-gate';
import { retryOnTransientLock } from './fs-retry';
import { isMindsBaseUrl } from '../shared/minds-endpoint';
import { describeFetchError } from './fetch-error';
import {
  type MindsOrg,
  type MindsOrgList,
  chooseMindsOrg,
  organizationLabel,
  personalOrgName,
  rankMindsOrgs,
  readOrgPreference,
  type StoredOrgPick,
  toMindsOrg,
  writeOrgPreference,
} from '../shared/minds-orgs';
import {
  MINDS_API_HOST,
  MINDS_KEYCLOAK_BASE,
  MINDS_AUTH_SERVICE_URL as AUTH_SERVICE_URL,
  MINDS_CONSOLE_HOST,
} from './minds-urls';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

const KEYCLOAK_BASE = MINDS_KEYCLOAK_BASE;
const KEYCLOAK_REALM = 'mindsdb';
// `anton-desktop` is the native Keycloak client used for the loopback
// PKCE flow in the desktop app.
const KEYCLOAK_CLIENT_ID = 'anton-desktop';
const TOKEN_URL = `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

// Login endpoints for the loopback PKCE flow, derived from the same
// env-aware base as everything else so the MINDSHUB_LOGIN IPC handler in
// index.ts never has to hardcode a host.
export const KEYCLOAK_AUTH_URL = `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth`;
export const KEYCLOAK_TOKEN_URL = TOKEN_URL;

// Keycloak's registration entry into the SAME authorization flow — accepts
// the identical OIDC params (client, PKCE, state, loopback redirect_uri) but
// opens on the create-account form instead of the login form. On completion
// Keycloak redirects to the loopback with a code exactly like sign-in, so
// sign-up rides the whole existing PKCE machinery (ENG-917).
export const KEYCLOAK_REGISTRATION_URL = `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/registrations`;

// Sign-up parks mid-flow on Keycloak's VERIFY_EMAIL required action while
// the user opens their inbox; clicking the emailed link (same browser)
// resumes the flow and hits the loopback with the code — verified against
// phasetwo-keycloak 26.5.7. The auth session that resume depends on lives
// ~30 min server-side (accessCodeLifespanLogin default), so wait exactly
// that long: shorter forfeits legitimate resumes, longer waits on a session
// that no longer exists. Past this window the renderer degrades to the
// "verified? just hit Sign in" path, never a re-registration.
export const SIGNUP_CALLBACK_TIMEOUT_MS = 30 * 60 * 1000;

// Base label for the MindsHub API key. ENG-440: keys are minted per
// device — the full name is `hub:anton:<installation_id>` (see
// antonKeyName). A single fixed name meant whoever logged in last deleted
// everyone else's key, silently 401-ing the other devices; per-device
// names let each install own its own key.
const ANTON_KEY_NAME = 'hub:anton';

// Per-device key name. Keeping the device id in the name (rather than
// tracking sessions server-side) fixes the displaced-device bug purely
// client-side. A cleanup/expiry policy for stale device keys is a
// deferred follow-up (ENG-440).
function antonKeyName(): string {
  return `${ANTON_KEY_NAME}:${getInstallationId()}`;
}

// Every auth-service / Keycloak request gets a hard deadline. Node's
// fetch has none by default, so a black-holed connection would hang
// the onboarding "TESTING LINK…" phase forever with no error to show.
const REQUEST_TIMEOUT_MS = 30_000;

// Retry budget for the fresh-signup org race (see ensureActiveOrg):
// 4 × 3s ≈ 12s, comfortably above the auth-service job's normal latency
// without stalling a genuinely org-less account's error forever.
const ORG_BOOTSTRAP_RETRIES = 4;
const ORG_BOOTSTRAP_RETRY_DELAY_MS = 3_000;

function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
}

// Outcome of a refresh-token exchange. The distinction matters (ENG-761):
// only `invalid_grant` means the session is definitively dead and local
// state may be destroyed. Everything else (network down at boot, Keycloak
// 5xx, timeout) is `transient` — the refresh token is still good and MUST
// be kept, otherwise one network blip at launch permanently signs the
// user out.
export type TokenRefreshResult =
  | { status: 'ok'; token: string }
  | { status: 'no_refresh_token' }
  | { status: 'invalid_grant' }
  | { status: 'superseded' }
  | { status: 'handoff_pending'; token: string }
  | { status: 'transient' };

// Refresh tokens only — no env writes, no server restart. Used during
// onboarding (e.g. after Stripe checkout, when we re-check roles), from
// the boot path, and on demand when the renderer asks for the access
// token.
//
// The access token IS the sidecar's gateway credential now, so a successful
// exchange hands the new one over before returning (see the saveTokens call
// below). That push is what keeps a running app working past the 10-minute
// lifetime without a restart.
//
// Single-flight: concurrent callers (boot refresh + settings-open check
// + the scheduled timer) share one Keycloak round-trip. Keycloak may be
// configured to rotate refresh tokens, so parallel exchanges with the
// same token are not just wasteful but potentially self-invalidating.
let _inflightRefresh: Promise<TokenRefreshResult> | null = null;
let _mindsCredentialSignOutDepth = 0;

/**
 * Fence ordinary credential readiness before logout performs any awaited
 * revoke work. A revoke-only refresh may rotate the persisted refresh token,
 * but it must never hand that credential to the sidecar or reopen the wake
 * barrier while sign-out is in progress.
 */
export function beginMindsCredentialSignOut(): void {
  _mindsCredentialSignOutDepth += 1;
  cancelScheduledRefresh();
  settleMindsResumeCredentialGate(false);
}

export function endMindsCredentialSignOut(): void {
  _mindsCredentialSignOutDepth = Math.max(0, _mindsCredentialSignOutDepth - 1);
}

export function refreshTokensOnly(): Promise<TokenRefreshResult> {
  if (!_inflightRefresh) {
    _inflightRefresh = doRefreshTokens().finally(() => { _inflightRefresh = null; });
  }
  return _inflightRefresh;
}

/**
 * Refresh after wake and arm the request barrier before any renderer turn can
 * leave the process with the credential that expired during sleep.
 */
export function refreshMindsCredentialAfterResume(): Promise<TokenRefreshResult> | null {
  if (!getRefreshToken() || !isAccessTokenExpired()) return null;

  beginMindsResumeCredentialGate();
  const resumeCancellationEpoch = _credentialHandoffCancellationEpoch;
  const refresh = (async () => {
    // A user-supplied key is already the sidecar's selected credential and does
    // not depend on Keycloak. Release turns after confirming that selection;
    // refresh the SSO session in the background for account UI continuity.
    const hasUserSuppliedCredential = await hasUserSuppliedMindsCredential();
    if (resumeCancellationEpoch !== _credentialHandoffCancellationEpoch) {
      return { status: 'superseded' } as const;
    }
    if (hasUserSuppliedCredential) {
      settleMindsResumeCredentialGate(true);
    }
    // Drain an exchange that started before the machine suspended, the same way
    // refreshAfterOrgSwitch drains one that started before the org switch. Its
    // socket died during sleep and its AbortSignal rides a monotonic clock that
    // does not advance while suspended, so joining it via the single-flight
    // guard would hold the barrier on a request that cannot answer.
    if (_inflightRefresh) await _inflightRefresh;
    if (resumeCancellationEpoch !== _credentialHandoffCancellationEpoch) {
      return { status: 'superseded' } as const;
    }
    return refreshTokensOnly();
  })();
  void refresh.then(
    (result) => {
      if (result.status === 'no_refresh_token') {
        settleMindsResumeCredentialGate(false);
      }
      // `ok` is settled by the awaited handoff below. A transient or pending
      // handoff keeps the barrier closed across its short retry timer.
    },
    (err) => {
      // Nothing in the body should reject today, but an armed barrier with no
      // settle path blocks every later turn for the life of the process, and
      // `void` would swallow the rejection with it.
      console.warn('[minds-auth] resume refresh failed before it could settle the gate:', err);
      settleMindsResumeCredentialGate(false);
    },
  );
  return refresh;
}

async function doRefreshTokens(): Promise<TokenRefreshResult> {
  // Capture this for the full exchange: getRevokeToken has its own deadline,
  // so the request can finish after the enclosing sign-out has returned.
  const suppressCredentialHandoff = _mindsCredentialSignOutDepth > 0;
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    settleMindsResumeCredentialGate(false);
    return { status: 'no_refresh_token' };
  }
  const tokenStoreVersion = getTokenStoreVersion();
  const credentialHandoffCancellationEpoch = _credentialHandoffCancellationEpoch;
  try {
    const res = await timedFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: KEYCLOAK_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!res.ok) {
      // Keycloak reports a dead session as 400 with error=invalid_grant.
      // Treat ONLY an explicit OAuth error on a 4xx as definitive; any
      // ambiguity (5xx, non-JSON body, rate limit) keeps the token.
      let oauthError = '';
      try { oauthError = String(((await res.json()) as { error?: string })?.error || ''); } catch { /* non-JSON */ }
      if (
        credentialHandoffCancellationEpoch
        !== _credentialHandoffCancellationEpoch
      ) {
        return { status: 'superseded' };
      }
      if (getTokenStoreVersion() !== tokenStoreVersion) {
        if (!suppressCredentialHandoff) void settleResumeGateFromSelectedCredential();
        return { status: 'superseded' };
      }
      if ((res.status === 400 || res.status === 401) && oauthError === 'invalid_grant') {
        console.warn('[minds-auth] refresh token rejected (invalid_grant) — clearing session');
        clearTokens();
        cancelScheduledRefresh();
        // The session JWT is definitively dead, so replace it in the sidecar.
        // Re-resolve rather than blindly clearing: a user-supplied mdb_ key is
        // independent of the dead SSO session and keeps its explicit priority;
        // without one, the same call clears the expired JWT.
        if (!suppressCredentialHandoff) void settleResumeGateFromSelectedCredential();
        return { status: 'invalid_grant' };
      }
      console.warn(`[minds-auth] token refresh failed transiently (HTTP ${res.status}${oauthError ? `, ${oauthError}` : ''}) — keeping tokens`);
      if (!suppressCredentialHandoff) scheduleRefreshRetry();
      return { status: 'transient' };
    }
    const data = await res.json() as { access_token?: unknown; expires_in?: number; refresh_token?: string };
    const cancelledMidExchange =
      credentialHandoffCancellationEpoch !== _credentialHandoffCancellationEpoch;
    if (getTokenStoreVersion() !== tokenStoreVersion) {
      // A newer login already owns the store, so this exchange's tokens are the
      // stale pair and must not overwrite it. Ordered ahead of the write below;
      // the cancellation fence is not, because these two say opposite things
      // about who holds the newer tokens.
      if (!cancelledMidExchange && !suppressCredentialHandoff) {
        void settleResumeGateFromSelectedCredential();
      }
      return { status: 'superseded' };
    }
    if (typeof data.access_token !== 'string' || !data.access_token) {
      console.warn('[minds-auth] token refresh returned no access token — keeping session');
      if (cancelledMidExchange) return { status: 'superseded' };
      if (!suppressCredentialHandoff) scheduleRefreshRetry();
      return { status: 'transient' };
    }
    const expiresInSeconds = data.expires_in ?? 3600;
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    // Persist BEFORE the cancellation fence. Keycloak has already rotated the
    // refresh token and invalidated the one we sent, so returning without
    // writing hands `endKeycloakSession` a token the IdP rejects: the SSO
    // session survives sign-out and the next sign-in silently reuses the same
    // account with no picker. `getRevokeToken` reads the fresh access token
    // back through `getAccessToken()` on this path.
    //
    // Sign-out still has to stop everything AFTER this write — handoff, retry,
    // timer, gate — which is what the fence below does. Only the write escapes,
    // because a rotation the IdP performed is already a fact locally.
    saveTokens(data.access_token, expiresInSeconds, data.refresh_token ?? refreshToken);
    if (cancelledMidExchange) {
      // Sign-out (or another explicit cancellation) began while this exchange
      // was in flight, so it captured the pre-bump epoch and `false` for the
      // suppression flag. Report superseded so no hand-over, retry, timer or
      // gate settlement escapes the fence.
      return { status: 'superseded' };
    }
    if (suppressCredentialHandoff) {
      // Same fence, for an exchange that started after sign-out began.
      return { status: 'ok', token: data.access_token };
    }
    const refreshedTokenStoreVersion = getTokenStoreVersion();
    // The exchange is not usable by a turn until the sidecar has accepted the
    // selected credential. `syncUsableMindsCredential` intentionally re-resolves
    // it so a user-supplied mdb_ key still wins over this new session JWT, and
    // it reports acceptance AND usability rather than acceptance alone.
    //
    // Both halves matter. A PUT can land while the value it carried is already
    // dead — sleep during the loopback call leaves `AbortSignal.timeout` on a
    // monotonic clock that does not advance, so the push completes on wake with
    // a JWT that expired hours earlier. Releasing the barrier on `landed` alone
    // would open it onto exactly that credential. Every sibling release path
    // (`retryCredentialHandoff`, `settleResumeGateFromSelectedCredential`,
    // `commitMindsSignIn`, `clearUserSuppliedMindsKey`) already checks both.
    const handedOff = await syncUsableMindsCredential();
    if (
      credentialHandoffCancellationEpoch
      !== _credentialHandoffCancellationEpoch
    ) {
      // Logout or another explicit cancellation already chose the gate state
      // and queued its own selected credential. This stale hand-over must not
      // reopen the barrier while that newer operation is still landing.
      return { status: 'superseded' };
    }
    if (getTokenStoreVersion() !== refreshedTokenStoreVersion) {
      // A newer login can overtake us while the loopback PUT is in flight.
      // Repair whatever that stale PUT may have left in the sidecar before
      // reporting that the refresh lost the race. Logout is handled by the
      // cancellation check above and must never enter this repair path.
      await settleResumeGateFromSelectedCredential();
      return { status: 'superseded' };
    }
    scheduleRefreshAt(expiresAt);
    if (!handedOff) {
      // Only a sidecar that exists can refuse. Boot refreshes tokens before it
      // starts one (index.ts), so an unconditional warn-and-retry here fired on
      // every launch of a signed-in install and buried the real hand-over
      // failures it exists to surface. `setServerStartedHook` pushes as soon as
      // the sidecar comes up, so a timer would only race that push.
      if (isMindsCredentialSidecarReachable()) {
        console.warn('[minds-auth] fresh credential was not handed to the sidecar — retrying hand-over');
        scheduleCredentialHandoffRetry();
      }
      return { status: 'handoff_pending', token: data.access_token };
    }
    cancelCredentialHandoffRetry();
    settleMindsResumeCredentialGate(true);
    return { status: 'ok', token: data.access_token };
  } catch (e: any) {
    if (
      credentialHandoffCancellationEpoch
      !== _credentialHandoffCancellationEpoch
    ) {
      return { status: 'superseded' };
    }
    if (getTokenStoreVersion() !== tokenStoreVersion) {
      if (!suppressCredentialHandoff) void settleResumeGateFromSelectedCredential();
      return { status: 'superseded' };
    }
    // Network failure / timeout — the token itself is fine. Retry later.
    console.warn('[minds-auth] token refresh unreachable — keeping tokens, will retry:', describeFetchError(e));
    if (!suppressCredentialHandoff) scheduleRefreshRetry();
    return { status: 'transient' };
  }
}

// RP-initiated Keycloak logout. Local clearTokens() is not enough on
// its own — Keycloak keeps an SSO session cookie in the IdP, so the
// next "Sign in" silently re-authenticates with the same account.
// Calling the end-session endpoint revokes the refresh token and
// kills the IdP-side session so the next login forces a fresh
// account picker. Must be called BEFORE clearTokens().
//
// Hard 3-second timeout: if the IdP is slow or unreachable (the dev
// gateway has had intermittent outages), the local logout must not
// hang on the network. Local state cleanup is the user-visible part;
// the SSO revocation is best-effort.
// ENG-498: logout passes the token explicitly — the detached revoke chain
// runs after clearTokens() has wiped the store.
export async function endKeycloakSession(refreshToken: string | null = getRefreshToken()): Promise<void> {
  if (!refreshToken) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await timedFetch(`${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
      signal: controller.signal,
    });
  } catch (error) {
    console.warn('[logout] Keycloak end-session failed or timed out', error);
  } finally {
    clearTimeout(timer);
  }
}

// ── Active-organization bootstrap ────────────────────────────────
//
// Auth-service scopes Hub access to an active organization. Desktop
// mirrors the web flow here: discover candidate orgs, switch if
// needed, and refresh so the token carries the chosen org claim.

interface OrgRef {
  id: string;
  name?: string;
  /** Raw Keycloak org name (the slug, e.g. `personal_<userId>`), distinct
   *  from the human display name — used to spot the user's personal org. */
  slug?: string;
  source?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    // Buffer is fine in the main process (Node); base64 → utf8.
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function normalizeOrgRef(value: any, source: string): OrgRef | null {
  const raw = value?.organization ?? value;
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.keycloak_id ?? raw.organization_id ?? raw.org_id ?? raw.name;
  if (!id) return null;
  return {
    id: String(id),
    name: raw.displayName ?? raw.display_name ?? raw.name ?? undefined,
    slug: raw.name ? String(raw.name) : undefined,
    source,
  };
}

function getActiveOrgFromPayload(payload: Record<string, unknown> | null): OrgRef | null {
  const raw =
    payload?.active_organization ??
    payload?.activate_organization ??
    payload?.organization;

  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return normalizeOrgRef(JSON.parse(raw), 'token-claim');
    } catch {
      const trimmed = raw.trim();
      return trimmed ? { id: trimmed, name: trimmed, source: 'token-claim' } : null;
    }
  }
  return normalizeOrgRef(raw, 'token-claim');
}

function hasActiveOrgClaim(payload: Record<string, unknown> | null): boolean {
  return Boolean(getActiveOrgFromPayload(payload));
}

// First source wins on identity, best source wins on the label.
//
// The token claim is pushed first and carries no display name — a personal
// organization arrives as the raw `personal_<userId>` — while
// `users/<id>/orgs` carries the one auth generated. Dropping the later
// duplicate outright meant the organization a person is actually in was the
// one entry guaranteed to show its slug. `name` equal to `slug` is how a
// source says it had no display name to give.
function pushUniqueOrg(target: OrgRef[], seen: Set<string>, org: OrgRef | null) {
  if (!org) return;
  if (seen.has(org.id)) {
    const existing = target.find((entry) => entry.id === org.id);
    if (existing && existing.name === existing.slug && org.name && org.name !== org.slug) {
      existing.name = org.name;
    }
    return;
  }
  seen.add(org.id);
  target.push(org);
}

async function getCurrentActiveOrg(accessToken: string): Promise<OrgRef | null> {
  try {
    const res = await timedFetch(
      `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/users/active-organization`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const body = await res.json() as unknown;
    const raw = Array.isArray((body as any)?.results)
      ? (body as any).results?.[0]
      : Array.isArray(body)
        ? (body as any[])[0]
        : body;
    return normalizeOrgRef(raw, 'active-organization-endpoint');
  } catch {
    return null;
  }
}

async function listUserOrgs(accessToken: string, userId: string): Promise<OrgRef[]> {
  try {
    const res = await timedFetch(
      `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/users/${encodeURIComponent(userId)}/orgs?first=0&max=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return [];
    const body = await res.json() as unknown;
    const raw = Array.isArray(body) ? body : Array.isArray((body as any)?.results) ? (body as any).results : [];
    // Some endpoints wrap each entry as { organization: {...} }; flatten.
    return raw
      .map((e: any) => normalizeOrgRef(e, 'user-orgs-endpoint'))
      .filter((e: OrgRef | null): e is OrgRef => Boolean(e));
  } catch {
    return [];
  }
}

async function listOrgCandidates(
  accessToken: string,
  userId: string,
  payload: Record<string, unknown> | null,
): Promise<OrgRef[]> {
  const candidates: OrgRef[] = [];
  const seen = new Set<string>();

  pushUniqueOrg(candidates, seen, getActiveOrgFromPayload(payload));
  pushUniqueOrg(candidates, seen, await getCurrentActiveOrg(accessToken));

  const orgs = await listUserOrgs(accessToken, userId);
  for (const org of orgs) pushUniqueOrg(candidates, seen, org);
  return candidates;
}

async function switchActiveOrg(accessToken: string, orgId: string): Promise<boolean> {
  try {
    const res = await timedFetch(
      `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/users/switch-organization`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: orgId }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Refresh the access token using the persisted refresh_token. The new
// token reflects whatever active-organization switch we just performed,
// and is saved back into the store so subsequent refreshes see the
// org-aware token. Returns the token string or null — the org-switch
// loops only care whether they got a usable token.
async function refreshAfterOrgSwitch(): Promise<string | null> {
  // An exchange that started before the org switch cannot contain the new
  // claim. Let it settle, then deliberately start a fresh exchange.
  if (_inflightRefresh) await _inflightRefresh;
  const result = await refreshTokensOnly();
  return result.status === 'ok' || result.status === 'handoff_pending'
    ? result.token
    : null;
}

// ── The organization pick, on disk ────────────────────────────────
//
// `state.json` in the Cowork home, beside the provider preferences. The
// decisions about the shape live in minds-orgs.ts; this is the file half.
// Both directions are best-effort: losing the pick costs a ranked default,
// never a working install.

function readCoworkState(): unknown {
  try {
    const statePath = coworkStatePath();
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readStoredOrgPreference(userId: string): StoredOrgPick | null {
  return readOrgPreference(readCoworkState(), userId);
}

function storeOrgPreference(userId: string, orgId: string, chosenByUser: boolean): void {
  try {
    fs.mkdirSync(coworkHome(), { recursive: true });
    const next = writeOrgPreference(readCoworkState(), userId, orgId, chosenByUser);
    fs.writeFileSync(coworkStatePath(), JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch (error) {
    console.warn('[minds-auth] failed to store the organization pick', error);
  }
}

// The live access token, refreshed once if the cached one has expired. The
// in-memory token is process-lifetime only, so right after a launch it can be
// empty while a perfectly good refresh token sits on disk.
export async function freshAccessToken(): Promise<string | null> {
  const cached = getAccessToken();
  if (cached && !isAccessTokenExpired()) return cached;
  if (!getRefreshToken()) return cached;
  const result = await refreshTokensOnly();
  return result.status === 'ok' || result.status === 'handoff_pending'
    ? result.token
    : getAccessToken();
}

export interface EnsureActiveOrgResult {
  token: string | null;
  candidates?: OrgRef[];
  /** Every organization this person belongs to, company ones first. */
  orgs?: MindsOrg[];
  /** The organization the returned token names. */
  activeOrgId?: string | null;
}

// Puts the access token on the organization this install should mint in, and
// makes sure it carries an active-organization claim at all.
//
// The claim used to be the whole answer: a token that already had one was
// returned untouched. That is how people ended up minting into
// their personal organization — whatever they last had active in a console
// tab decided where their laptop's key went, and nothing on either surface
// said so. Now the claim is an input rather than the verdict: company
// organizations rank ahead of personal ones, a pick the person made by hand
// beats the ranking, and the switch only happens when the answer differs from
// the claim.
//
// That last clause is what keeps this free for the common case. An account
// with one organization chooses it, finds the claim already names it, and
// makes no switch and no refresh — the same number of round-trips as before.
export async function ensureActiveOrg(
  accessToken: string,
  options: { preferOrgId?: string } = {},
): Promise<EnsureActiveOrgResult> {
  const payload = decodeJwtPayload(accessToken);
  const hasClaim = hasActiveOrgClaim(payload);
  const userId = typeof payload?.sub === 'string' ? payload.sub : null;
  if (!userId) {
    return { token: hasClaim ? accessToken : null };
  }

  let candidates = await listOrgCandidates(accessToken, userId, payload);
  // Brand-new accounts (ENG-917): the personal org is provisioned
  // asynchronously (Keycloak REGISTER webhook → auth-service job), so a
  // user who verifies their email within seconds can land here before it
  // exists. Retry briefly before declaring the account org-less.
  // Established accounts always have ≥1 org on the first pass, so this
  // loop costs them nothing — and a token carrying a claim always contributes
  // that organization, so it never waits here either.
  for (let i = 0; candidates.length === 0 && i < ORG_BOOTSTRAP_RETRIES; i++) {
    await new Promise((r) => setTimeout(r, ORG_BOOTSTRAP_RETRY_DELAY_MS));
    candidates = await listOrgCandidates(accessToken, userId, payload);
  }
  if (candidates.length === 0) {
    return { token: hasClaim ? accessToken : null };
  }

  const orgs = rankMindsOrgs(candidates.map((org) => toMindsOrg(org, userId)));
  const activeOrgId = getActiveOrgFromPayload(payload)?.id ?? null;
  // `preferOrgId` outranks the stored pick: it is somebody naming an
  // organization now, rather than the one this install last landed on. It goes
  // through `chooseMindsOrg` rather than straight to a switch, so it is matched
  // against a real membership first.
  //
  // Nothing is persisted here, deliberately. Making an organization active and
  // remembering it are two decisions, and this function only makes the first:
  // its caller can still move the session afterwards, and a preference written
  // before that settled is what left `state.json` and the live session naming
  // different organizations (ENG-2199).
  //
  // Only a pick a person made is stored at all, by `selectEntitledOrg`, and
  // only such a row outranks the ranking. Where a sign-in happens to land is
  // session-only and recomputed next time. The `chosenByUser` check below is
  // therefore a forward guard rather than a live discriminator: nothing writes
  // `false` today, and it is what stops the next person who reaches for
  // "remember where we ended up" retiring the company-first default (ENG-1954)
  // after a single launch — someone who signed in with only a personal
  // organization and later joined a company one would stay in Personal for
  // good, because the entitlement hunt only revises a row when the
  // organization cannot pay.
  const storedPick = readStoredOrgPreference(userId);
  const chosen = chooseMindsOrg(
    orgs,
    options.preferOrgId ?? (storedPick?.chosenByUser ? storedPick.orgId : null),
  );

  if (chosen && hasClaim && chosen.id === activeOrgId) {
    return { token: accessToken, candidates, orgs, activeOrgId };
  }

  // The chosen organization first, then the rest in ranked order. A Keycloak
  // refusal on the preferred one must still leave the token with some claim,
  // because everything downstream needs one and none of it cares which.
  const targets = chosen ? [chosen, ...orgs.filter((org) => org.id !== chosen.id)] : orgs;
  for (const target of targets) {
    const ok = await switchActiveOrg(accessToken, target.id);
    if (!ok) continue;

    const refreshed = await refreshAfterOrgSwitch();
    if (!refreshed) continue;
    const refreshedPayload = decodeJwtPayload(refreshed);
    if (hasActiveOrgClaim(refreshedPayload)) {
      return {
        token: refreshed,
        candidates,
        orgs,
        activeOrgId: getActiveOrgFromPayload(refreshedPayload)?.id ?? target.id,
      };
    }
  }

  // Nothing could be made active. A token that already carried a claim is
  // still usable: ranking is an improvement on where the key lands, never a
  // precondition for getting one.
  return { token: hasClaim ? accessToken : null, candidates, orgs, activeOrgId };
}

// ── Key listing and revocation ────────────────────────────────────
//
// Nothing here mints any more. The desktop presents the user's own session
// credential, so the only reason to touch `/v1/api-keys/` is to clean up the
// per-device keys earlier builds left behind: on sign-out, and once on the
// first launch of a build that no longer mints.
//
// The per-device name is still `hub:anton:<installation_id>`, and matching it
// exactly is still what stops one machine revoking another's.

export interface SelectedOrgResult {
  // The token to present, carrying an active-organization claim. Absent when
  // no organization could be selected, in which case `error` says why.
  token?: string;
  // Free-form message for the renderer to paint on the welcome screen.
  error?: string;
  // The organization the returned token names. The ranking says where it
  // should land and the entitlement hunt can still move it, so onboarding
  // displays this rather than what it asked for.
  organization?: MindsOrg;
}

// Lists every API key on the account, following DRF-style `next`
// pagination so a key is never missed because it fell off the first page.
// ENG-440: this matters now that we deliberately let keys accumulate per
// account (the legacy `hub:anton` is kept, per-device keys add up) — a
// single-page read could miss this device's own prior `hub:anton:<id>`
// and mint a duplicate under the same name on every re-onboard. A bare
// array means the endpoint isn't paginated and is already the full list.
// Best-effort: any failure returns what we have so far so key creation
// still proceeds.
interface ApiKeyListEntry {
  name?: string;
  prefix?: string;
  created?: string;
  expiry_date?: string | null;
  // Auth-service DELETE is a soft delete (perform_destroy sets revoked=True
  // and keeps the row for the audit trail), and the list endpoint does NOT
  // filter revoked rows — so every consumer here must, or revoked keys are
  // indistinguishable from live ones.
  revoked?: boolean;
}

async function listExistingKeys(accessToken: string): Promise<ApiKeyListEntry[]> {
  const collected: ApiKeyListEntry[] = [];
  let url: string | null = `${AUTH_SERVICE_URL}/api-keys/`;
  // Hard page cap so a malformed `next` chain can't loop forever.
  for (let page = 0; url && page < 50; page++) {
    try {
      const res = await timedFetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) break;
      const body = await res.json() as { results?: unknown; next?: unknown } | unknown[];
      if (Array.isArray(body)) {
        collected.push(...(body as ApiKeyListEntry[]));
        break;
      }
      const results = (body as { results?: unknown }).results;
      if (Array.isArray(results)) {
        collected.push(...(results as ApiKeyListEntry[]));
      }
      const next = (body as { next?: unknown }).next;
      url = typeof next === 'string' && next ? next : null;
    } catch {
      break;
    }
  }
  return collected;
}

async function deleteKeyByPrefix(accessToken: string, prefix: string): Promise<void> {
  try {
    const res = await timedFetch(`${AUTH_SERVICE_URL}/api-keys/${encodeURIComponent(prefix)}/`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Best-effort cleanup — a failed delete never blocks the caller — but
    // a silent failure here is exactly what let the renewal-rollback bug
    // hide, so at least make it diagnosable. `prefix` is the public
    // display prefix, not a secret.
    if (!res.ok) console.warn('[minds-auth] key delete returned', res.status, 'for prefix', prefix);
  } catch {
    // best-effort cleanup — proceed with the new key creation regardless
  }
}

// ENG-498: on explicit sign-out, delete THIS device's own key(s) so a
// retired session doesn't leave a live, mintable credential behind.
// Exact-name matches only — never the legacy fixed `hub:anton` (a
// not-yet-upgraded device may still rely on it) and never other
// devices' keys (that's the ENG-440 silent-revocation bug).
//
// listExistingKeys/deleteKeyByPrefix both swallow their own failures
// (best-effort by design), so a zero-match result is otherwise silent and
// indistinguishable from "already revoked" — log which case happened at
// least once so a stuck key is diagnosable. The key NAME is safe to log:
// it's just `hub:anton:<installation_id>`, not a secret.
async function revokeAntonApiKeys(accessToken: string): Promise<void> {
  const keyName = antonKeyName();
  const existing = await listExistingKeys(accessToken);
  let revoked = 0;
  for (const entry of existing) {
    // Skip rows auth already soft-revoked: every sign-in's pre-mint cleanup
    // adds one, so they accumulate — and they list oldest-first, so deleting
    // them here burns the 5s revoke budget before reaching the one live key
    // (the newest) that actually needs revoking.
    if (entry?.name === keyName && entry.prefix && entry.revoked !== true) {
      await deleteKeyByPrefix(accessToken, entry.prefix);
      revoked++;
    }
  }
  if (revoked === 0) {
    console.warn('[logout] no per-device key found to revoke (name=%s) — list failed, key already gone, or key lives in another org', keyName);
  } else {
    console.log('[logout] revoked %d device key(s)', revoked);
  }
}

// Bounds the revoke phase of logout. Without this, a black-holed
// auth-service delays endKeycloakSession by up to 30-90s (list + several
// sequential deletes, each carrying the 30s timedFetch deadline) — long
// enough that the IdP SSO session outlives the moment the user already
// saw "signed out": clicking Sign in during that window silently
// re-authenticates, the exact bug end-session exists to prevent. On
// timeout we abandon the revoke and fall through to end-session; the
// un-revoked key still falls to the server-side TTL.
const LOGOUT_REVOKE_TIMEOUT_MS = 5_000;

// Detached logout cleanup: revoke this device's key while the session is
// still valid, then end the IdP session. Ordering matters — end-session
// first would leave the revoke racing an invalidated session. Both are
// best-effort; the caller (AUTH_LOGOUT) deliberately does not await this,
// so failures may not block sign-out. Exported (rather than inlined in
// the handler) so the ordering is unit-testable.
export async function revokeDeviceKeyAndEndSession(
  accessToken: string | null,
  refreshToken: string | null,
): Promise<void> {
  try {
    if (accessToken) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          revokeAntonApiKeys(accessToken),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, LOGOUT_REVOKE_TIMEOUT_MS); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch (err) {
    console.warn('[logout] device key revoke failed:', err instanceof Error ? err.message : err);
  } finally {
    await endKeycloakSession(refreshToken);
  }
}

// Best-effort token for the logout revoke. The common case (valid cached
// token) is synchronous; an expired token gets ONE refresh attempt bounded
// by `timeoutMs` so a hung IdP can never stall sign-out. On timeout the
// caller proceeds without the revoke — the key then falls to the TTL.
//
// NOTE: a refresh here may ROTATE the persisted refresh token (Keycloak
// may be configured to rotate it on exchange — see the _inflightRefresh
// comment above). Callers composing this with endKeycloakSession must
// read getRefreshToken() AFTER awaiting getRevokeToken, never before —
// otherwise they'd hand end-session a refresh token the exchange already
// superseded.
export async function getRevokeToken(timeoutMs = 5_000): Promise<string | null> {
  const cached = getAccessToken();
  if (cached && !isAccessTokenExpired()) return cached;
  if (!getRefreshToken()) return cached;
  let timer: NodeJS.Timeout | undefined;
  try {
    const refreshed = await Promise.race([
      refreshTokensOnly(),
      new Promise<null>((resolve) => { timer = setTimeout(resolve, timeoutMs, null); }),
    ]);
    return refreshed && (refreshed.status === 'ok' || refreshed.status === 'handoff_pending')
      ? refreshed.token
      : getAccessToken();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Probes the auth-service `/authenticate/` endpoint, which both
// validates the bearer token and returns the user's entitlements.
// Used as a sanity check before POST /api-keys/ so we can distinguish
// "token isn't accepted at all" from "token is valid but the user
// can't create LLM keys" — those two failure modes need different
// recovery UX, and the create endpoint alone can't tell them apart.
async function fetchAuthContext(accessToken: string): Promise<{
  ok: boolean;
  status: number;
  body: any;
  entitlements?: any;
}> {
  try {
    const res = await timedFetch(`${AUTH_SERVICE_URL}/authenticate/`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // mindshub_frontend pins this header so the auth-service can
        // scope entitlements to the hub product. Without it the
        // server may return a different (or empty) entitlement set.
        'X-MindsDB-Product': 'hub',
      },
    });
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    const ent = body?.entitlements;
    // Diagnostic: the exact HUB-scoped entitlement set the auth-service
    // returned. This is what the upgrade gate keys off — log it so a
    // failing machine tells us "no subscription" vs "wrong product/org"
    // instead of surfacing a generic error.
    console.log(
      '[minds-auth] /authenticate/ status=%s agents.use=%s api_keys.create=%s deploy_agents=%s',
      res.status,
      ent?.permissions?.agents?.use ? 'true' : 'false',
      ent?.permissions?.api_keys?.create ? 'true' : 'false',
      ent?.allocations?.deploy_agents,
    );
    return { ok: res.ok, status: res.status, body, entitlements: body?.entitlements };
  } catch (e: any) {
    return { ok: false, status: 0, body: { error: e?.message || String(e) } };
  }
}

function normalizeHubEntitlements(entitlements: any) {
  const permissions = entitlements?.permissions || {};
  const allocations = entitlements?.allocations || {};
  return {
    permissions: {
      agents: {
        use: permissions?.agents?.use === true,
      },
    },
    allocations: {
      deploy_agents: Number(allocations?.deploy_agents || 0),
    },
  };
}

// Whether this organization can actually run turns for the user. Formerly this
// also required `api_keys.create`, because the app had to mint a key here; it
// presents the user's own credential now, so the ability to create a key says
// nothing about whether the account can use the product.
function entitledToUseAnton(entitlements: any): boolean {
  const normalized = normalizeHubEntitlements(entitlements);
  return (
    normalized.allocations.deploy_agents > 0 &&
    normalized.permissions.agents.use === true
  );
}

// Held while any path is moving the active organization. The account-menu switch
// and the entitlement selection both drive the same server-side Keycloak session,
// and the selection switches more than once — per candidate, then once more to
// put the session back — so interleaving them leaves the two disagreeing.
//
// A promise rather than a boolean because the two contenders want different
// answers to "someone else is going": a second switch is refused, while a
// selection waits (ENG-2199).
let _orgSwitchInFlight: Promise<void> | null = null;

// Pick the organization the presented token will name, and return that token.
//
// The active-organization claim is not a nicety: auth's `/v1/authenticate/`
// answers 401 outright for a JWT that carries no active organization, so a token
// without one is refused at the gateway on every turn. `ensureActiveOrg` is what
// guarantees it, and it also decides WHICH organization: company ones ahead of
// personal, a pick the person made by hand ahead of the ranking.
//
// Beyond that, the claim decides whose credits a turn spends, so when the active
// organization cannot run turns at all we look for one that can rather than
// leaving the user signed in and unable to send a message. Lacking the
// entitlement is NOT a sign-in blocker: if no organization qualifies we keep the
// active one and let the gateway say so at the point of use, which is where the
// top-up card is raised.
//
// `chosenByUser` is the one thing that stops that search. An automatic
// optimization may pick an organization only when nobody else has: running it
// over a person's explicit answer moves them out of the organization they just
// nominated to pay, which is precisely what the picker asked them to decide.
// It is a separate flag rather than "`preferOrgId` is set" on purpose — that
// happens to be true of today's only caller, and a future one passing a stored
// id would silently disable the fallback with nothing failing. This whole
// function exists because two layers agreed implicitly once already (ENG-2199).
export async function selectEntitledOrg(
  initialToken: string,
  options: { preferOrgId?: string; chosenByUser?: boolean } = {},
): Promise<SelectedOrgResult> {
  // Wait rather than refuse. Refusing looks tidier but is the worse answer:
  // `ReconnectCard` escalates any `ok: false` straight to `mindshubLogin()`
  // (ChatView.jsx), so a moment's contention would put a full browser sign-in in
  // front of someone whose session was fine.
  //
  // Waiting is also correct rather than merely kinder. Once the switch commits
  // it records its organization as a person's choice, so the run that follows
  // short-circuits on it instead of hunting them out of it again. The loop
  // re-checks because another waiter may take the lock first.
  // Awaited bare: the handle is only ever resolved — it is created two lines
  // below with no `reject` in scope, and settled in a `finally` — so there is no
  // rejection here to swallow, and a `catch` would only hide one if that ever
  // changed.
  while (_orgSwitchInFlight) {
    await _orgSwitchInFlight;
  }
  let release: () => void = () => {};
  _orgSwitchInFlight = new Promise<void>((resolve) => { release = resolve; });
  try {
    // Re-read after acquiring: `initialToken` was captured before the wait, so
    // a switch that completed while we queued has already superseded it. Acting
    // on the old claim lets `ensureActiveOrg` fall back to it and move the
    // session off the organization the person just chose.
    return await doSelectEntitledOrg(getAccessToken() ?? initialToken, options);
  } finally {
    _orgSwitchInFlight = null;
    release();
  }
}

async function doSelectEntitledOrg(
  initialToken: string,
  options: { preferOrgId?: string; chosenByUser?: boolean } = {},
): Promise<SelectedOrgResult> {
  const orgResult = await ensureActiveOrg(initialToken, { preferOrgId: options.preferOrgId });
  if (!orgResult.token) {
    return {
      error:
        'Could not select an active MindsHub organization for this account. ' +
        `Sign in at ${MINDS_CONSOLE_HOST.replace(/^https?:\/\//, '')} once to create or join an organization, then try again.`,
    };
  }
  const accessToken = orgResult.token;
  const startedPayload = decodeJwtPayload(accessToken);
  // Where the hunt below starts from, and therefore what it has to put back if
  // it finds nothing.
  const startedInOrgId = getActiveOrgFromPayload(startedPayload)?.id ?? null;
  const userId = typeof startedPayload?.sub === 'string' ? startedPayload.sub : null;
  const stored = userId ? readStoredOrgPreference(userId) : null;
  // `chosenByUser` says a person answered the question. It does NOT say the
  // session reached their answer: `ensureActiveOrg` falls through to another
  // organization when Keycloak refuses a switch, because everything downstream
  // needs some claim and none of it cares which. An organization arrived at
  // that way is not the person's choice, must not inherit its protection from
  // the fallback, and must not be recorded as chosen — a stamp nothing would
  // ever be able to correct.
  const landedOnRequest = !options.preferOrgId || startedInOrgId === options.preferOrgId;
  // The hunt may only revise an organization nobody chose. "Chose" covers the
  // picker a moment ago AND a choice made on an earlier run: honouring one only
  // until the next Reconnect would reproduce the same bug on a delay.
  const activeWasChosen = Boolean(
    (options.chosenByUser && landedOnRequest)
    || (stored?.chosenByUser && startedInOrgId && stored.orgId === startedInOrgId),
  );
  // Which organization a token ends up naming, for the caller to display. The
  // ranking in ensureActiveOrg and the entitlement hunt below can each move it,
  // so it is read back off the token rather than from what was asked for.
  const namedOrg = (token: string): MindsOrg | undefined => {
    const id = getActiveOrgFromPayload(decodeJwtPayload(token))?.id;
    return id ? (orgResult.orgs || []).find((org) => org.id === id) : undefined;
  };

  // Only a pick a person made is ever written. Where a call happened to run is
  // not evidence about what they want, and recording it costs more than it buys
  // in three separate ways:
  //
  //   - `state.json` holds ONE `mindsOrganization` slot, so an automatic write
  //     on an ordinary sign-in replaces whatever is in it — including a
  //     different account's deliberate pick, which that person never gets back.
  //   - `listUserOrgs` folds a failed read, a timeout and a genuinely empty
  //     membership into the same `[]`, so a Keycloak blip is enough to land
  //     somewhere else and have it recorded as though it were settled.
  //   - a row this build writes is read by an older one after a rollback, which
  //     has no provenance flag and treats every row as somebody's choice.
  //
  // A hunt result or a restore therefore lives only in the session, and the
  // next read recomputes it from the ranking. Nothing is lost by that: the
  // organization a turn bills comes from the token, never from this file.
  const settleOn = (token: string, chosenByUser: boolean): SelectedOrgResult => {
    const id = getActiveOrgFromPayload(decodeJwtPayload(token))?.id;
    if (userId && id && chosenByUser) storeOrgPreference(userId, id, true);
    return { token, organization: namedOrg(token) };
  };

  const ctx = await fetchAuthContext(accessToken);
  if (ctx.ok && entitledToUseAnton(ctx.entitlements)) {
    return settleOn(accessToken, activeWasChosen);
  }

  // A genuine auth failure is the only hard stop: the token is not accepted at
  // all, so no organization choice can help.
  if (!ctx.ok) {
    const bodyExcerpt = JSON.stringify(ctx.body || {}).slice(0, 280);
    if (ctx.status === 401 || ctx.status === 403) {
      return {
        error:
          `MindsHub rejected the access token at /authenticate/ (HTTP ${ctx.status}). ` +
          `Body: ${bodyExcerpt}.`,
      };
    }
    if (ctx.status >= 500 || ctx.status === 0) {
      const detail = ctx.status === 0
        ? 'Could not reach the MindsHub authentication service.'
        : `The MindsHub authentication service returned an error (HTTP ${ctx.status}).`;
      return {
        error:
          `${detail} ` +
          'This is usually temporary — please try again in a moment. ' +
          'If the problem persists, you can continue with your own API key instead.',
      };
    }
    return { error: `Auth-service /authenticate/ returned HTTP ${ctx.status}.` };
  }

  // The organization cannot run turns — and if a person chose it, that is the
  // end of the selection rather than the start of a search. A wallet-empty
  // organization is not a sign-in blocker for anybody else either: the gateway
  // raises the top-up card on the first turn, which is exactly what an
  // unentitled user meets today when they have nowhere else to be moved to.
  if (activeWasChosen) {
    console.warn(
      '[minds-auth] the chosen organization has no HUB entitlement; honouring the '
      + 'choice and leaving the quota to the gateway: org=%s',
      startedInOrgId ?? 'unknown',
    );
    return settleOn(accessToken, true);
  }

  const tried = new Set<string>();
  if (startedInOrgId) tried.add(startedInOrgId);
  // Whether the loop actually moved the session. A hunt that never switched has
  // nothing to put back, and restoring regardless would spend a switch and a
  // token exchange on accounts that previously spent neither.
  let moved = false;
  for (const candidate of orgResult.candidates || []) {
    if (!candidate?.id || tried.has(candidate.id)) continue;
    tried.add(candidate.id);
    if (!(await switchActiveOrg(accessToken, candidate.id))) continue;
    moved = true;
    const refreshed = await refreshAfterOrgSwitch();
    if (!refreshed) continue;
    const candidateCtx = await fetchAuthContext(refreshed);
    if (candidateCtx.ok && entitledToUseAnton(candidateCtx.entitlements)) {
      // Recorded as NOT chosen: the next run may revise it again, and a landing
      // that dressed itself up as somebody's decision could never be corrected.
      return settleOn(refreshed, false);
    }
  }

  // Nothing qualified, which is not a sign-in blocker: the gateway enforces the
  // quota at the point of use. Put the session back where the hunt found it —
  // a search that failed must not relocate anyone, which is the rule
  // `doSwitchMindsOrg` already follows on every one of its own failure
  // branches. Left un-restored, the user lands in whichever organization the
  // loop happened to try last: an artifact of Keycloak's list order rather
  // than anybody's choice (ENG-2199).
  const restored = moved
    ? await restoreActiveOrg(getAccessToken() ?? accessToken, startedInOrgId)
    : true;
  const norm = normalizeHubEntitlements(ctx.entitlements);
  console.warn(
    '[minds-auth] signed in without a HUB entitlement in any organization '
    + '(quota enforced at the gateway): agents.use=%s deploy_agents=%s',
    norm.permissions.agents.use ? 'true' : 'false',
    norm.allocations.deploy_agents,
  );
  const settled = getAccessToken() ?? accessToken;
  if (!restored) {
    // The hunt moved the session and could not put it back, so this person is
    // sitting in an organization nobody chose — picked by Keycloak's list order,
    // not by them. Returning the token would report that as success and leave
    // them there. Recoverable and worth retrying: everything above is a read
    // apart from the switches, and the next attempt starts from wherever the
    // session actually is.
    // Deliberately unnamed. A personal organization's `displayName` is
    // `<email>'s organization`, so interpolating it here would put the exact
    // string ENG-2109 removed from every other surface back into a message a
    // person reads — which `organizationLabelSurfaces.test.js` guards against
    // for this file by name.
    return {
      error:
        'Could not put this computer back in its organization after checking which one can pay. '
        + 'Try again in a moment.',
    };
  }
  // Not chosen, and it cannot be: a chosen organization returned at the
  // short-circuit above and never reaches the hunt at all.
  return settleOn(settled, false);
}

// ── Env commit ────────────────────────────────────────────────────

const MINDS_KEYS = [
  'ANTON_MINDS_ENABLED',
  'ANTON_MINDS_URL',
  // NOTE: ANTON_OPENAI_API_KEY / ANTON_OPENAI_BASE_URL are intentionally
  // NOT in this strip list (ENG-436). MindsHub no longer commandeers the
  // OpenAI slot — the scratchpad resolves minds-cloud natively via
  // minds_api_key/minds_url (cowork-server `_resolve_coding`). Leaving
  // them out means a user's own OpenAI key survives a MindsHub login,
  // the same way the Anthropic key already does.
  'ANTON_MINDS_API_KEY',
  // NOTE: ANTON_PLANNING_MODEL / ANTON_CODING_MODEL are intentionally NOT
  // stripped (ENG-739). They may hold a value the user set deliberately for
  // the standalone `anton` CLI (e.g. `ANTON_PLANNING_MODEL=latest:opus` via a
  // hand-edited .env or the settings PUT API). A `latest:` prefix is not
  // provable provenance, so wiping these on re-login silently mutates the
  // user's CLI config. Leaving them untouched preserves that config; sign-in
  // no longer *writes* a model pin, so a fresh user still gets the server's
  // enabled-aware default.
  'ANTON_ANTHROPIC_API_KEY',
  'ANTON_OPENAI_API_KEY_CUSTOM',
  'ANTON_GEMINI_API_KEY',
];

// Provider selection, held apart from MINDS_KEYS because sign-in replaces it
// only when it is also the thing choosing the provider (see runsOwnEndpoint).
const PROVIDER_KEYS = ['ANTON_PLANNING_PROVIDER', 'ANTON_CODING_PROVIDER'];

function envValue(content: string, key: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith(key + '=')) return line.slice(key.length + 1).trim();
  }
  return '';
}

/**
 * Whether the config already points inference at an endpoint of the user's own.
 *
 * Signing in is how MindsHub is connected for publishing and connectors too, so
 * it must not double as a routing change: someone running a local model keeps
 * running it. Credentials are still written -- only the provider selection is
 * left alone. Both the stored and incoming MindsHub URLs have to disagree with
 * the base URL, so a sign-in that moves the account between environments does
 * not read as a custom endpoint.
 */
export function runsOwnEndpoint(existingEnv: string, mindsHost: string): boolean {
  const base = envValue(existingEnv, 'ANTON_OPENAI_BASE_URL');
  if (!base) return false;
  return !isMindsBaseUrl(base, envValue(existingEnv, 'ANTON_MINDS_URL'))
    && !isMindsBaseUrl(base, mindsHost);
}

// Pure: given the existing `.env` contents, produce the contents to write on
// MindsHub sign-in.
//
// **It writes no credential and never has one to write.** The gateway credential
// is handed to the sidecar at runtime (minds-credential.ts), so the only reason
// `ANTON_MINDS_API_KEY` still appears in MINDS_KEYS is to STRIP it: an install
// upgrading from a build that wrote one has a live key sitting in this file, and
// signing in is the moment it goes.
//
// What is still written is the non-credential half — the MindsHub URL and, when
// the user is not on an endpoint of their own, the provider selection.
//
// Deliberately writes NO ANTON_PLANNING_MODEL / ANTON_CODING_MODEL, and (as of
// ENG-739) no longer strips them either — MINDS_KEYS omits both model keys, so
// any model line the user set for the standalone CLI survives re-login. Pinning
// `latest:sonnet` / `latest:haiku` here (an ENG-436-era guard against
// deprecated-alias 500s) became fatal once tier gating shipped: it made every
// sign-in an *explicit* model pick, so the server's enabled-aware default
// (which only fills an unset model) could never steer a free-tier user to a
// model their plan allows → first message 403s (ENG-597/ENG-739). Leaving the
// model unset for a fresh user lets the server resolve the right model per tier.
export function buildMindsEnvContent(existing: string, host: string): string {
  const keepProvider = runsOwnEndpoint(existing, host);
  const strip = keepProvider ? MINDS_KEYS : [...MINDS_KEYS, ...PROVIDER_KEYS];
  const lines = existing.split('\n')
    .filter(l => !strip.some(k => l.startsWith(k + '=')));
  lines.push(
    'ANTON_MINDS_ENABLED=true',
    `ANTON_MINDS_URL=${host}`,
  );
  if (!keepProvider) {
    lines.push('ANTON_PLANNING_PROVIDER=minds-cloud', 'ANTON_CODING_PROVIDER=minds-cloud');
  }
  return lines.filter(Boolean).join('\n') + '\n';
}

// The DB setting keys a MindsHub sign-in must push, and ONLY these.
//
// `minds_api_key` is deliberately absent: it is pushed to the sidecar's runtime
// holder instead of stored, which is the whole point of this change. Everything
// here is non-secret configuration.
//
// Deliberately excludes planning_model / coding_model (ENG-739). The old sign-
// in path POSTed the whole `.env` to `/settings/raw`, which re-reads the full
// `.env` from disk and syncs EVERY recognised key — so a legacy `.env` model
// line (or a stale login-written `latest:` pin) would clobber a model the user
// just fixed via the picker, with no way to leave the model untouched. Writing
// only these keys leaves the DB's model rows (and any picker fix) alone.
export function mindsSignInSettingWrites(
  host: string,
  keepProvider = false,
): Array<{ key: string; value: string }> {
  const target = [{ key: 'minds_url', value: host }];
  // A user on their own endpoint gets the URL and nothing else -- repointing
  // here would undo the choice the .env write just preserved.
  if (keepProvider) return target;
  return [
    ...target,
    { key: 'planning_provider', value: 'minds_cloud' },
    { key: 'coding_provider', value: 'minds_cloud' },
    // router_provider too (ENG-1632): with no stored row the server serializes
    // its pydantic default (anthropic) and the client can't tell "no row" from
    // "user chose anthropic" — so the Settings save-path guard saw a
    // permanently-differing provider and repointed the router on EVERY
    // default-mode save, materializing an aux-model pin as a side effect.
    { key: 'router_provider', value: 'minds_cloud' },
  ];
}


// Durable `.env` write for Windows: at sign-in finalize this runs while the old
// server still holds the file open, which EPERM'd onboarding (ENG-1209). The fix
// is the temp-write-then-atomic-rename with retry — the write lands on a fresh,
// unlocked path and only the rename contends with the lock. Two things matter:
//   1. Atomic — a torn/failed write must never truncate `.env` (it holds the
//      user's OTHER credentials/consent flags), so it's data loss, not a lost key.
//   2. mode 0o600 on the temp — it holds the full plaintext key and lives at
//      that mode through every retry and any crash, so it must be owner-only from
//      creation, not just after the trailing chmod on the final path. `mode` is
//      accepted on Windows (it just has limited POSIX semantics) and the temp is
//      unlocked, so it can't reintroduce the EPERM this write class hit.
export async function writeEnvFileAtomic(
  targetPath: string,
  content: string,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<void> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  // Sweep only STALE orphaned temps from a prior hard-kill / power-loss between
  // the write and the rename — they hold the full plaintext key, so they must
  // never linger. The age threshold is what lets this coexist with the random
  // suffix below: a concurrent writer's in-flight temp is fresh and spared, so
  // the sweep can't yank it out from under a live rename.
  const STALE_TMP_MS = 5 * 60 * 1000;
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`${base}.tmp-`)) continue;
      const p = path.join(dir, name);
      try {
        if (now - fs.statSync(p).mtimeMs > STALE_TMP_MS) fs.rmSync(p, { force: true });
      } catch { /* best-effort — gone already or unreadable */ }
    }
  } catch { /* dir unreadable — nothing to sweep */ }
  // Random suffix (not pid alone) so two writers can never collide on the name.
  const tmpPath = path.join(dir, `${base}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
  try {
    await retryOnTransientLock(() => fs.renameSync(tmpPath, targetPath), opts);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * Commit a MindsHub sign-in: the non-credential config to disk and the DB, and
 * the credential itself to the sidecar's runtime holder.
 *
 * The credential never lands in either store. `buildMindsEnvContent` strips any
 * `ANTON_MINDS_API_KEY` an older build left in `.env`, and
 * `mindsSignInSettingWrites` no longer carries `minds_api_key`, so what this
 * writes is the MindsHub URL and the provider selection.
 *
 * **No restart.** The sidecar used to be stopped and started here so it would
 * re-read `.env`. Nothing needs re-reading now: settings go over loopback and
 * the credential is handed over the same way, so a sign-in no longer kills a
 * running turn.
 */
export async function commitMindsSignIn(): Promise<void> {
  const homeDir = coworkHome();
  // ~/.cowork normally exists by the time SSO finalize runs (the server creates
  // it on boot), but if the server failed to start the write would ENOENT.
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true });
  }
  const envPath = coworkEnvPath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  // Decided from the .env as it was BEFORE this sign-in rewrote it, so the
  // provider decision and the settings write agree.
  const keepProvider = runsOwnEndpoint(existing, MINDS_API_HOST);
  // Atomic + lock-tolerant write that wedged onboarding on Windows (ENG-1209).
  let envWriteError: unknown = null;
  try {
    await writeEnvFileAtomic(envPath, buildMindsEnvContent(existing, MINDS_API_HOST));
    // The file no longer holds a MindsHub credential, but it still holds the
    // user's other provider keys, so it stays owner-only. Best-effort, and a
    // no-op on Windows.
    try { fs.chmodSync(envPath, 0o600); } catch { /* best-effort */ }
  } catch (err) {
    envWriteError = err;
    console.warn('[minds-auth] .env write failed', err);
  }

  // Ensure state.json has minds-cloud as the active provider so the server
  // doesn't default to Anthropic on first boot (state.json may not exist yet
  // after a flush).
  const statePath = coworkStatePath();
  try {
    let state: any = { preferences: {} };
    if (fs.existsSync(statePath)) {
      try { state = JSON.parse(fs.readFileSync(statePath, 'utf-8')); } catch { state = { preferences: {} }; }
    }
    if (!state.preferences) state.preferences = {};
    // Keep only minds-cloud; remove any other provider entries.
    const existingProviders: any[] = Array.isArray(state.preferences.providers) ? state.preferences.providers : [];
    const mindsEntry = existingProviders.find((p: any) => p?.type === 'minds-cloud') ?? { type: 'minds-cloud' };
    mindsEntry.isDefault = true;
    state.preferences.providers = [mindsEntry];
    fs.mkdirSync(coworkHome(), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch (error) {
    console.warn('[minds-auth] failed to set provider state', error);
  }

  // On a fresh install the server isn't available yet: the setup wizard runs
  // after this and starts it, and that start hands the credential over on its
  // own (`setServerStartedHook` in index.ts). The renderer's post-install
  // handshake does NOT cover this — it replays `.env`, which no longer carries
  // a MindsHub credential.
  const { antonInstalled } = await checkInstallStatus();
  if (!antonInstalled) {
    // Nothing else has stored this sign-in yet, so a failed write here leaves
    // no record of it at all and must surface rather than reporting success.
    if (envWriteError) throw envWriteError;
    console.log('[minds-auth] server not installed yet — setup will sync after install');
    return;
  }

  // A sidecar that died is started rather than restarted: a stop/start would
  // drop a credential a previous push had already established.
  if (!isServerRunning() && !isServerStarting()) {
    await startServer();
  }
  if (!isServerRunning() && !isServerStarting()) {
    console.warn('[minds-auth] sidecar unavailable — sign-in will sync on its next start');
    return;
  }

  // The credential goes FIRST, and a failure here ABORTS before the provider
  // writes below. `config_ready` is false without it, and flipping
  // planning/coding to minds_cloud anyway would repoint a user who had a
  // working provider onto one with no credential behind it. Bailing leaves the
  // prior configuration intact; the boot path re-pushes on the next start and
  // the next sign-in retries the whole sequence.
  if (!(await syncUsableMindsCredential())) {
    console.warn('[minds-auth] credential hand-over failed at sign-in — leaving the prior provider config intact');
    return;
  }
  settleMindsResumeCredentialGate(true);

  const port = getServerPort();
  // Individual `PUT /settings/{key}` writes for exactly the sign-in fields —
  // NOT `POST /settings/raw`. That endpoint re-reads the full .env from
  // disk and syncs EVERY recognised key, so a legacy/stale model line in .env
  // would clobber a model the user just fixed via the picker.
  for (const { key, value } of mindsSignInSettingWrites(MINDS_API_HOST, keepProvider)) {
    try {
      // authHeader(): main-process fetch — the webRequest injection hook only
      // covers renderer requests, so this must carry the server bearer token
      // itself when COWORK_REQUIRE_AUTH=true.
      const res = await timedFetch(`http://127.0.0.1:${port}/api/v1/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        console.warn(`[minds-auth] settings PUT ${key} returned`, res.status);
      }
    } catch (error) {
      console.warn(`[minds-auth] failed to write ${key} to server DB`, error);
    }
  }

  // Verify the server actually reads as configured. A restart is NOT the repair
  // any more: the credential lives in the sidecar's memory, so restarting is
  // what would lose it. Push again instead.
  try {
    const healthRes = await timedFetch(`http://127.0.0.1:${port}/api/v1/health/`);
    if (healthRes.ok) {
      const health = await healthRes.json() as Record<string, unknown>;
      if (!health.config_ready) {
        console.warn('[minds-auth] config_ready is false after sign-in — re-pushing the credential');
        await syncMindsCredential();
      }
    }
  } catch (error) {
    console.warn('[minds-auth] health check after sign-in failed:', error);
  }
}

let _refreshTimer: NodeJS.Timeout | null = null;

// The normal refresh runs with a 60-second expiry buffer, and the wake barrier
// gives a held turn only MINDS_RESUME_READY_TIMEOUT_MS. Retry fast enough to
// land inside both, then back off: attempts at T+10 through T+50 all fall
// inside the expiry buffer, and past it the fast interval buys nothing while a
// long IdP outage would cost 360 token POSTs an hour on every installed client.
const REFRESH_RETRY_DELAY_MS = 10_000;
const REFRESH_RETRY_MAX_DELAY_MS = 60_000;
const REFRESH_RETRIES_INSIDE_BUFFER = 5;
const CREDENTIAL_HANDOFF_RETRY_DELAY_MS = 10_000;
const CREDENTIAL_HANDOFF_RETRY_MAX_DELAY_MS = 60_000;
const CREDENTIAL_HANDOFF_RETRIES_INSIDE_BUFFER = 5;

/**
 * Fast fixed retries while the expiry buffer and the wake barrier still care,
 * then exponential backoff to a ceiling.
 *
 * The fast attempts stay exactly `baseMs` apart, with no jitter: they are the
 * ones the buffer argument justifies, and keeping them exact keeps the refresh
 * timing tests deterministic. Jitter starts with the backed-off attempts, which
 * is where a fleet that entered the loop together would otherwise return to a
 * struggling IdP together.
 */
function retryDelay(attempt: number, baseMs: number, maxMs: number, fastAttempts: number): number {
  if (attempt < fastAttempts) return baseMs;
  const backedOff = Math.min(baseMs * 2 ** (attempt - fastAttempts + 1), maxMs);
  return Math.min(backedOff + Math.floor(Math.random() * 2_000), maxMs);
}

let _refreshRetryAttempt = 0;
let _credentialHandoffRetryAttempt = 0;

let _credentialHandoffTimer: NodeJS.Timeout | null = null;
let _credentialHandoffRetryGeneration = 0;
let _credentialHandoffCancellationEpoch = 0;

export function scheduleRefresh(expiresInSeconds: number): void {
  scheduleRefreshAt(Date.now() + expiresInSeconds * 1000);
}

export function scheduleRefreshRetry(): void {
  const attempt = _refreshRetryAttempt++;
  scheduleRefreshIn(retryDelay(
    attempt,
    REFRESH_RETRY_DELAY_MS,
    REFRESH_RETRY_MAX_DELAY_MS,
    REFRESH_RETRIES_INSIDE_BUFFER,
  ));
}

export function cancelScheduledRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = null;
  _refreshRetryAttempt = 0;
  _credentialHandoffCancellationEpoch += 1;
  cancelCredentialHandoffRetry();
}

function scheduleRefreshIn(delayMs: number): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // refreshTokensOnly re-arms the timer itself on every outcome that
  // warrants one (ok → next expiry window, transient → retry delay), so
  // the chain never dies after a single failure — the pre-ENG-761 timer
  // ran silentRefresh once and never retried.
  _refreshTimer = setTimeout(() => { void refreshTokensOnly(); }, delayMs);
}

function scheduleRefreshAt(expiresAt: number): void {
  // Only reached after a successful exchange, so the outage is over.
  _refreshRetryAttempt = 0;
  scheduleRefreshIn(Math.max(expiresAt - Date.now() - 60_000, 10_000));
}

/* Hand the selected credential to a sidecar that has just started, and release
 * whatever is waiting on that hand-over.
 *
 * Every other landing path settles the resume barrier and cancels the retry
 * ladder; the server-start hook pushed and did neither. A sidecar that restarts
 * during a post-wake retry therefore came back holding a usable credential
 * while the barrier stayed armed, so `POST /api/v1/responses` kept being held
 * its full bound and cancelled until the backed-off retry next came round. */
export async function handOffMindsCredentialToStartedSidecar(): Promise<boolean> {
  const usable = await syncUsableMindsCredential();
  if (usable) {
    cancelCredentialHandoffRetry();
    settleMindsResumeCredentialGate(true);
  }
  return usable;
}

function cancelCredentialHandoffRetry(): void {
  _credentialHandoffRetryGeneration += 1;
  _credentialHandoffRetryAttempt = 0;
  if (_credentialHandoffTimer) clearTimeout(_credentialHandoffTimer);
  _credentialHandoffTimer = null;
}

function scheduleCredentialHandoffRetry(): void {
  const attempt = _credentialHandoffRetryAttempt;
  cancelCredentialHandoffRetry();
  // cancelCredentialHandoffRetry resets the counter because it is also the
  // cancel path; this loop carries its own attempt forward.
  _credentialHandoffRetryAttempt = attempt + 1;
  const generation = _credentialHandoffRetryGeneration;
  // A sidecar that predates the hand-over route answers 404 and cannot recover
  // without a restart, and the server-start hook in index.ts already re-pushes
  // on the next start. Back off rather than PUT every 10s forever.
  _credentialHandoffTimer = setTimeout(() => {
    _credentialHandoffTimer = null;
    void retryCredentialHandoff(generation);
  }, retryDelay(
    attempt,
    CREDENTIAL_HANDOFF_RETRY_DELAY_MS,
    CREDENTIAL_HANDOFF_RETRY_MAX_DELAY_MS,
    CREDENTIAL_HANDOFF_RETRIES_INSIDE_BUFFER,
  ));
}

async function retryCredentialHandoff(generation: number): Promise<void> {
  const result = await syncMindsCredentialSelection();
  if (generation !== _credentialHandoffRetryGeneration) return;
  if (result.usable && result.landed) {
    cancelCredentialHandoffRetry();
    settleMindsResumeCredentialGate(true);
    return;
  }
  if (!result.usable) {
    // Logout may race an already-running callback after its timer was cleared.
    // A successful empty PUT is not readiness, and there is no value to retry.
    settleMindsResumeCredentialGate(false);
    return;
  }
  scheduleCredentialHandoffRetry();
}

async function settleResumeGateFromSelectedCredential(): Promise<void> {
  // A newer login or a user-supplied mdb_ key is usable; a successful PUT of
  // an empty value is not. Keep that distinction when deciding whether a turn
  // held across resume may proceed.
  const cancellationEpoch = _credentialHandoffCancellationEpoch;
  const ready = await syncUsableMindsCredential();
  if (cancellationEpoch === _credentialHandoffCancellationEpoch) {
    settleMindsResumeCredentialGate(ready);
  }
}
// ── Organization switching ────────────────────────────────────────
//
// Nothing mints, so switching organization is switch the session, refresh the
// token, hand the fresh one to the sidecar. The active-organization claim is
// what the gateway reads to decide whose credits a turn spends, and the
// refresh re-rolls it — there is no key to move, retire, or roll back.

// One switch at a time: two interleaving would race each other through the
// token store and the hand-over.

/**
 * Put the active organization back, and say whether the token followed it.
 *
 * The two failures are not the same. Keycloak refusing the switch leaves the
 * session exactly where it was, so the token still describes it and a caller
 * may act on that. A switch that lands while its refresh fails moves the
 * session and leaves the token naming the organization it came from — the
 * refresh keeps the old tokens on anything short of `invalid_grant` — so the
 * token stops being evidence of where the session is, and anything recorded
 * from it is a guess (ENG-2199).
 */
async function restoreActiveOrg(token: string, orgId: string | null): Promise<boolean> {
  if (!orgId) return true;
  // Both halves have to be true, and only the token can prove it: a refused
  // switch leaves the session on the last candidate, and a switch that lands
  // with a failed refresh leaves the token naming that candidate instead. Each
  // reads as "restored" from one side alone.
  //
  // Tried twice because the whole reason this runs is a Keycloak that has been
  // answering badly, and one more attempt is far cheaper than the alternative:
  // relocating somebody permanently because a search found nothing.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bearer = getAccessToken() ?? token;
    if (await switchActiveOrg(bearer, orgId)) {
      const refreshed = await refreshAfterOrgSwitch();
      if (refreshed && getActiveOrgFromPayload(decodeJwtPayload(refreshed))?.id === orgId) {
        return true;
      }
    }
  }
  console.warn('[minds-auth] could not put the active organization back to %s', orgId);
  return false;
}

/** Every organization the signed-in person belongs to, company ones first. */
export async function listMindsOrgs(): Promise<MindsOrgList> {
  const token = await freshAccessToken();
  if (!token) return { orgs: [], activeOrgId: null };
  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.sub === 'string' ? payload.sub : null;
  if (!userId) return { orgs: [], activeOrgId: null };
  const candidates = await listOrgCandidates(token, userId, payload);
  return {
    orgs: rankMindsOrgs(candidates.map((org) => toMindsOrg(org, userId))),
    activeOrgId: getActiveOrgFromPayload(payload)?.id ?? null,
  };
}

export interface SwitchMindsOrgResult {
  ok: boolean;
  /** Where the app is now: the target on success, where it started on failure. */
  activeOrgId: string | null;
  orgs: MindsOrg[];
  /** A sentence to show. Present only when `ok` is false. */
  error?: string;
}

/**
 * Make `targetOrgId` this install's organization: switch the session, move the
 * credential, remember the pick, and retire the key left behind.
 */
export async function switchMindsOrg(targetOrgId: string): Promise<SwitchMindsOrgResult> {
  if (_orgSwitchInFlight) {
    return {
      ok: false,
      activeOrgId: null,
      orgs: [],
      // Not necessarily "a change": since ENG-2199 the holder is just as likely
      // to be a sign-in or a Reconnect working out which organization this
      // computer is in, which the person did not ask for and would not
      // recognise. Name the state, not an action they think they took.
      error: 'Cowork is still settling which organization this computer is in. Try again in a moment.',
    };
  }
  let release: () => void = () => {};
  _orgSwitchInFlight = new Promise<void>((resolve) => { release = resolve; });
  try {
    return await doSwitchMindsOrg(targetOrgId);
  } finally {
    _orgSwitchInFlight = null;
    release();
  }
}

async function doSwitchMindsOrg(targetOrgId: string): Promise<SwitchMindsOrgResult> {
  const token = await freshAccessToken();
  if (!token) return { ok: false, activeOrgId: null, orgs: [], error: 'Sign in to change organization.' };

  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.sub === 'string' ? payload.sub : null;
  if (!userId) return { ok: false, activeOrgId: null, orgs: [], error: 'Could not read the signed-in account.' };

  const sourceOrgId = getActiveOrgFromPayload(payload)?.id ?? null;
  const candidates = await listOrgCandidates(token, userId, payload);
  const orgs = rankMindsOrgs(candidates.map((org) => toMindsOrg(org, userId)));

  // Membership is decided here against what Keycloak says this person belongs
  // to, and the switch below goes through Keycloak's own switch-organization
  // endpoint. Nothing takes an organization id from the caller and puts it on
  // a credential request.
  const target = orgs.find((org) => org.id === targetOrgId);
  if (!target) {
    return { ok: false, activeOrgId: sourceOrgId, orgs, error: 'That organization is not one you belong to.' };
  }
  if (target.id === sourceOrgId) {
    storeOrgPreference(userId, target.id, true);
    return { ok: true, activeOrgId: sourceOrgId, orgs };
  }

  if (!await switchActiveOrg(token, target.id)) {
    return {
      ok: false,
      activeOrgId: sourceOrgId,
      orgs,
      error: `MindsHub would not switch to ${organizationLabel(target)}. Nothing changed.`,
    };
  }

  const switched = await refreshAfterOrgSwitch();
  if (!switched) {
    // The switch landed on Keycloak even though this token did not follow it,
    // so the session has genuinely moved and has to be moved back.
    await restoreActiveOrg(token, sourceOrgId);
    return {
      ok: false,
      activeOrgId: sourceOrgId,
      orgs,
      error: `Could not refresh the session for ${organizationLabel(target)}. Nothing changed.`,
    };
  }

  // Hand the re-rolled token over before reporting success. Skipping it would
  // leave the sidecar presenting a token that still names the old organization
  // until the next refresh tick, so turns would bill the organization the
  // person just left while the menu said otherwise.
  if (!await syncMindsCredential()) {
    await restoreActiveOrg(switched, sourceOrgId);
    return {
      ok: false,
      activeOrgId: sourceOrgId,
      orgs,
      error: 'Could not hand the new credential to the local server. Nothing changed.',
    };
  }

  storeOrgPreference(userId, target.id, true);
  return { ok: true, activeOrgId: target.id, orgs };
}
