import { saveTokens, getRefreshToken, clearTokens, getTokenStoreVersion, getAccessToken, isAccessTokenExpired } from './token-store';
import { stopServer, startServer, isServerRunning, isServerStarting, getServerPort } from './server-process';
import { checkInstallStatus } from './installer';
import { coworkHome, coworkEnvPath, coworkStatePath } from './cowork-home';
import { getInstallationId } from './installation-id';
import { authHeader } from './server-auth';
import { retryOnTransientLock } from './fs-retry';
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

// ── Per-device key renewal decision (ENG-498) ─────────────────────
//
// The auth-service may stamp an absolute expiry on device keys
// (API_KEYS__DEVICE_KEY_TTL_DAYS, auth #145). Renew when under this
// fraction of the key's own lifetime remains — deriving the window from
// created/expiry_date keeps the client correct for whatever TTL ops
// picks, with no config knob. An already-expired key also renews (heal):
// the laptop may have slept past the deadline, or expiry may have been
// backfilled server-side before this client updated.
const KEY_RENEWAL_LIFETIME_FRACTION = 0.25;

// When the lifetime can't be derived (missing/garbled `created`, or
// created >= expiry), fall back to a fixed window rather than never
// renewing — a wrong-but-safe early renewal beats a 401 at the deadline.
const KEY_RENEWAL_FALLBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function shouldRenewKey(
  created: string | null | undefined,
  expiryDate: string | null | undefined,
  nowMs: number,
): boolean {
  if (!expiryDate) return false;
  const expiryMs = Date.parse(expiryDate);
  if (Number.isNaN(expiryMs)) return false;
  const remainingMs = expiryMs - nowMs;
  if (remainingMs <= 0) return true;
  const createdMs = created ? Date.parse(created) : NaN;
  const lifetimeMs = expiryMs - createdMs;
  const windowMs = Number.isNaN(createdMs) || lifetimeMs <= 0
    ? KEY_RENEWAL_FALLBACK_WINDOW_MS
    : lifetimeMs * KEY_RENEWAL_LIFETIME_FRACTION;
  return remainingMs < windowMs;
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
  | { status: 'transient' };

// Refresh tokens only — no env writes, no server restart. Used during
// onboarding (e.g. after Stripe checkout, when we re-check roles), from
// the boot path, and on demand when the renderer asks for the access
// token. The LLM env credential is a long-lived API key minted by the
// auth-service and isn't tied to the JWT lifetime, so refreshing the
// JWT never needs to touch env.
//
// Single-flight: concurrent callers (boot refresh + settings-open check
// + the scheduled timer) share one Keycloak round-trip. Keycloak may be
// configured to rotate refresh tokens, so parallel exchanges with the
// same token are not just wasteful but potentially self-invalidating.
let _inflightRefresh: Promise<TokenRefreshResult> | null = null;

export function refreshTokensOnly(): Promise<TokenRefreshResult> {
  if (!_inflightRefresh) {
    _inflightRefresh = doRefreshTokens().finally(() => { _inflightRefresh = null; });
  }
  return _inflightRefresh;
}

async function doRefreshTokens(): Promise<TokenRefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return { status: 'no_refresh_token' };
  const tokenStoreVersion = getTokenStoreVersion();
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
      if (getTokenStoreVersion() !== tokenStoreVersion) return { status: 'superseded' };
      if ((res.status === 400 || res.status === 401) && oauthError === 'invalid_grant') {
        console.warn('[minds-auth] refresh token rejected (invalid_grant) — clearing session');
        clearTokens();
        cancelScheduledRefresh();
        cancelKeyLifecycleChecks();
        return { status: 'invalid_grant' };
      }
      console.warn(`[minds-auth] token refresh failed transiently (HTTP ${res.status}${oauthError ? `, ${oauthError}` : ''}) — keeping tokens`);
      scheduleRefreshRetry();
      return { status: 'transient' };
    }
    const data = await res.json() as { access_token?: unknown; expires_in?: number; refresh_token?: string };
    if (getTokenStoreVersion() !== tokenStoreVersion) return { status: 'superseded' };
    if (typeof data.access_token !== 'string' || !data.access_token) {
      console.warn('[minds-auth] token refresh returned no access token — keeping session');
      scheduleRefreshRetry();
      return { status: 'transient' };
    }
    saveTokens(data.access_token, data.expires_in ?? 3600, data.refresh_token ?? refreshToken);
    scheduleRefresh(data.expires_in ?? 3600);
    return { status: 'ok', token: data.access_token };
  } catch (e: any) {
    if (getTokenStoreVersion() !== tokenStoreVersion) return { status: 'superseded' };
    // Network failure / timeout — the token itself is fine. Retry later.
    console.warn('[minds-auth] token refresh unreachable — keeping tokens, will retry:', e?.message || e);
    scheduleRefreshRetry();
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

function pushUniqueOrg(target: OrgRef[], seen: Set<string>, org: OrgRef | null) {
  if (!org || seen.has(org.id)) return;
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
  return result.status === 'ok' ? result.token : null;
}

export interface EnsureActiveOrgResult {
  token: string | null;
  candidates?: OrgRef[];
}

// Ensures the in-memory access token carries an active organization
// claim. Idempotent — tokens that already have the claim short-circuit.
export async function ensureActiveOrg(accessToken: string): Promise<EnsureActiveOrgResult> {
  const payload = decodeJwtPayload(accessToken);
  if (hasActiveOrgClaim(payload)) {
    const userId = typeof payload?.sub === 'string' ? payload.sub : '';
    const candidates = userId ? await listOrgCandidates(accessToken, userId, payload) : [];
    return { token: accessToken, candidates };
  }

  const userId = typeof payload?.sub === 'string' ? payload.sub : null;
  if (!userId) {
    return { token: null };
  }

  let orgs = await listOrgCandidates(accessToken, userId, payload);
  // Brand-new accounts (ENG-917): the personal org is provisioned
  // asynchronously (Keycloak REGISTER webhook → auth-service job), so a
  // user who verifies their email within seconds can land here before it
  // exists. Retry briefly before declaring the account org-less.
  // Established accounts always have ≥1 org on the first pass, so this
  // loop costs them nothing.
  for (let i = 0; orgs.length === 0 && i < ORG_BOOTSTRAP_RETRIES; i++) {
    await new Promise((r) => setTimeout(r, ORG_BOOTSTRAP_RETRY_DELAY_MS));
    orgs = await listOrgCandidates(accessToken, userId, payload);
  }
  if (orgs.length === 0) {
    return { token: null };
  }

  for (const target of orgs) {
    const ok = await switchActiveOrg(accessToken, target.id);
    if (!ok) continue;

    const refreshed = await refreshAfterOrgSwitch();
    if (!refreshed) continue;
    if (hasActiveOrgClaim(decodeJwtPayload(refreshed))) {
      return { token: refreshed, candidates: orgs };
    }
  }

  return { token: null, candidates: orgs };
}

// ── API key provisioning ──────────────────────────────────────────
//
// Calls the auth-service `/v1/api-keys/` endpoint with the JWT as a
// Bearer credential. ENG-440: the key is minted under a per-device name
// (`hub:anton:<installation_id>`), and we remove only a prior key with
// that exact per-device name before re-minting — so re-onboarding on this
// machine doesn't pile up dead keys, while a login on a *different* device
// never revokes this one. The returned `key` is the actual `mdb_*` string
// the LLM gateway expects. Returns null on any error so callers can
// surface a user-visible message instead of writing a bad credential to
// env.

interface ApiKeyRecord {
  key?: string;
  name?: string;
  prefix?: string;
}

export interface ProvisionResult {
  // `mdb_*` API key on success.
  key?: string;
  // The minted key's prefix (identifies it for rollback in the renewal
  // path — see commitRenewedKey).
  prefix?: string;
  // True iff the auth-service rejected the request because the user
  // lacks the entitlement to mint LLM keys (free tier). Surfaced to
  // the renderer so it can route to the paywall instead of treating
  // this as a generic failure.
  upgradeRequired?: boolean;
  // True iff the mint hit the account's active-key cap (HTTP 409). The
  // renewal path treats this as "retry once, deleting own prior key".
  limitReached?: boolean;
  // Free-form error message for any other failure (network, auth
  // expired, etc.). Renderer paints it on the welcome screen.
  error?: string;
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
    return refreshed && refreshed.status === 'ok' ? refreshed.token : getAccessToken();
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

function canCreateApiKeys(entitlements: any): boolean {
  return entitlements?.permissions?.api_keys?.create === true;
}

function normalizeHubEntitlements(entitlements: any) {
  const permissions = entitlements?.permissions || {};
  const allocations = entitlements?.allocations || {};
  return {
    permissions: {
      agents: {
        use: permissions?.agents?.use === true,
      },
      api_keys: {
        create: permissions?.api_keys?.create === true,
      },
    },
    allocations: {
      deploy_agents: Number(allocations?.deploy_agents || 0),
    },
  };
}

function requiresHubUpgrade(entitlements: any): boolean {
  const normalized = normalizeHubEntitlements(entitlements);
  return (
    normalized.allocations.deploy_agents <= 0 ||
    normalized.permissions.agents.use !== true
  );
}

function canUseAntonWithMinds(entitlements: any): boolean {
  return canCreateApiKeys(entitlements) && !requiresHubUpgrade(entitlements);
}

export interface ProvisionOptions {
  // Renewal (ENG-498) mints the replacement while the old key is still
  // valid — in-flight sessions may hold it, and the TTL reaps it anyway —
  // so it skips the delete. Sign-in keeps the default and stays tidy.
  deleteExistingKey?: boolean;
}

export async function provisionAntonApiKey(
  initialToken: string,
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const { deleteExistingKey = true } = options;
  const orgResult = await ensureActiveOrg(initialToken);
  if (!orgResult.token) {
    return {
      error:
        'Could not select an active MindsHub organization for this account. ' +
        `Sign in at ${MINDS_CONSOLE_HOST.replace(/^https?:\/\//, '')} once to create or join an organization, then try again.`,
    };
  }
  const accessToken = orgResult.token;
  const initialPayload = decodeJwtPayload(accessToken);
  const currentOrg = getActiveOrgFromPayload(initialPayload);

  const ctx = await fetchAuthContext(accessToken);
  let provisionToken = accessToken;
  let provisionCtx = ctx;

  if (!ctx.ok || !canUseAntonWithMinds(ctx.entitlements)) {
    const tried = new Set<string>();
    if (currentOrg?.id) tried.add(currentOrg.id);

    // Try other orgs to find one where the user is fully entitled, so the
    // minted key is scoped to the best org. If none qualifies we keep the
    // active org and proceed anyway — lacking the HUB subscription is NOT
    // a sign-in blocker.
    for (const candidate of orgResult.candidates || []) {
      if (!candidate?.id || tried.has(candidate.id)) continue;
      tried.add(candidate.id);
      const switched = await switchActiveOrg(provisionToken, candidate.id);
      if (!switched) continue;
      const refreshed = await refreshAfterOrgSwitch();
      if (!refreshed) continue;
      const candidateCtx = await fetchAuthContext(refreshed);
      if (!candidateCtx.ok) continue;
      if (canUseAntonWithMinds(candidateCtx.entitlements)) {
        provisionToken = refreshed;
        provisionCtx = candidateCtx;
        break;
      }
    }

    // Genuine auth failure (bad/expired token, service error) — can't
    // mint a key, so surface it. This is the ONLY hard stop here.
    if (!provisionCtx.ok) {
      const bodyExcerpt = JSON.stringify(provisionCtx.body || {}).slice(0, 280);
      if (provisionCtx.status === 401 || provisionCtx.status === 403) {
        return {
          error:
            `MindsHub rejected the access token at /authenticate/ (HTTP ${provisionCtx.status}). ` +
            `Body: ${bodyExcerpt}.`,
        };
      }
      // Server errors (5xx) or network failures (status 0) — the auth
      // service is likely temporarily unavailable. Give the user an
      // actionable message instead of a raw status code.
      if (provisionCtx.status >= 500 || provisionCtx.status === 0) {
        const detail = provisionCtx.status === 0
          ? 'Could not reach the MindsHub authentication service.'
          : `The MindsHub authentication service returned an error (HTTP ${provisionCtx.status}).`;
        return {
          error:
            `${detail} ` +
            'This is usually temporary — please try again in a moment. ' +
            'If the problem persists, you can continue with your own API key instead.',
        };
      }
      return {
        error: `Auth-service /authenticate/ returned HTTP ${provisionCtx.status}.`,
      };
    }

    // Authenticated but lacking the HUB entitlement (no subscription):
    // proceed to mint and flow the user in. Quota/upgrade is enforced at
    // the gateway (point of use) and surfaced post-auth in the app — we no
    // longer gate sign-in on it.
    if (!canUseAntonWithMinds(provisionCtx.entitlements)) {
      const norm = normalizeHubEntitlements(provisionCtx.entitlements);
      console.warn(
        '[minds-auth] authenticated without HUB entitlement — minting anyway '
        + '(quota enforced at the gateway): agents.use=%s api_keys.create=%s deploy_agents=%s',
        norm.permissions.agents.use ? 'true' : 'false',
        norm.permissions.api_keys.create ? 'true' : 'false',
        norm.allocations.deploy_agents,
      );
    }

    // Safeguard: if the active org can't mint a key (the user landed in a
    // SHARED org where they're only a member), fall back to their PERSONAL
    // org. The personal-org owner always has create+use (auth-side
    // owner_roles), so this guarantees an authenticated user can get a key
    // without weakening shared-org permissions or the paid instance gate.
    if (!canCreateApiKeys(provisionCtx.entitlements)) {
      const userId = typeof initialPayload?.sub === 'string' ? initialPayload.sub : '';
      const personal = userId
        ? (orgResult.candidates || []).find((o) => o.slug === `personal_${userId}`)
        : undefined;
      if (personal && personal.id !== getActiveOrgFromPayload(decodeJwtPayload(provisionToken))?.id) {
        const switched = await switchActiveOrg(provisionToken, personal.id);
        if (switched) {
          const refreshed = await refreshAfterOrgSwitch();
          if (refreshed) {
            const personalCtx = await fetchAuthContext(refreshed);
            if (personalCtx.ok && canCreateApiKeys(personalCtx.entitlements)) {
              provisionToken = refreshed;
              provisionCtx = personalCtx;
              console.log('[minds-auth] minting in personal org (active org lacked api_keys.create)');
            }
          }
        }
      }
    }
  }

  // Step 1: drop only THIS device's prior key so re-onboarding on the same
  // machine stays tidy. ENG-440: match the exact per-device name and never
  // the legacy fixed `hub:anton` — deleting a key another (not-yet-upgraded)
  // device still relies on is precisely the silent-revocation bug we're
  // fixing. Best-effort — listing/deleting failures shouldn't block creation
  // of the new key.
  const keyName = antonKeyName();
  if (deleteExistingKey) {
    const existing = await listExistingKeys(provisionToken);
    for (const entry of existing) {
      // revoked !== true: auth's delete is a soft delete, so prior sign-ins'
      // cleanup rows keep listing forever — re-deleting them is one wasted
      // round-trip each per sign-in.
      if (entry?.name === keyName && entry.prefix && entry.revoked !== true) {
        await deleteKeyByPrefix(provisionToken, entry.prefix);
      }
    }
  }

  // Step 2: mint a new key. The auth-service returns the full secret
  // exactly once in the create response — store it now. A 402 (or a
  // body with `code: 'upgrade_required'`) means the user is on the
  // free tier — surface that distinctly so the renderer can show the
  // paywall instead of a generic error.
  try {
    const res = await timedFetch(`${AUTH_SERVICE_URL}/api-keys/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provisionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: keyName }),
    });
    if (res.ok) {
      const data = await res.json() as ApiKeyRecord;
      if (data?.key) return { key: data.key, prefix: data.prefix };
      return { error: 'Auth-service did not return an API key value.' };
    }
    type ErrorBody = { code?: string; detail?: string; error?: string; message?: string };
    let body: ErrorBody | null = null;
    try { body = await res.json() as ErrorBody; } catch { /* not JSON */ }
    if (res.status === 402 || body?.code === 'upgrade_required') {
      return { upgradeRequired: true };
    }
    // 409 on this endpoint is only ever the active-key cap
    // (max_active_per_user_organization). Surfaced distinctly so the
    // renewal path can retry with its own prior key deleted instead of
    // failing identically every tick until the 401 deadline.
    if (res.status === 409) {
      return {
        limitReached: true,
        error: body?.detail || body?.error || body?.message || 'API key limit reached.',
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        error:
          `MindsHub rejected the API-key request (HTTP ${res.status}). ` +
          (body?.detail || body?.error || body?.message || 'No detail returned.'),
      };
    }
    return { error: body?.detail || body?.error || body?.message || `Auth-service returned HTTP ${res.status}` };
  } catch (e: any) {
    return { error: `Could not reach the auth-service: ${e?.message || e}` };
  }
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
  'ANTON_PLANNING_PROVIDER',
  'ANTON_CODING_PROVIDER',
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

// Writes the MindsHub LLM credentials to the Cowork config home's .env
// (coworkEnvPath(); merge, not overwrite) and restarts the python server so it
// picks them up.
// `apiKey` MUST be the `mdb_*` value minted via `provisionAntonApiKey`
// — passing a raw Keycloak JWT here is what caused the historic 401s
// from the LLM gateway. The live MindsHub gateway expects the
// `latest:*` alias namespace; the older deprecated sentinel aliases
// 500 with "Mind not found".
//
// ENG-436: we write ONLY the dedicated minds_* slots — never
// ANTON_OPENAI_API_KEY / ANTON_OPENAI_BASE_URL. cowork-server resolves
// minds-cloud from minds_api_key/minds_url for both the main agent and
// the scratchpad, and `check_configured` is satisfied by minds_api_key
// alone, so the OpenAI slot is no longer needed — and leaving it
// untouched lets a user's own OpenAI key survive login.
// Pure: given the existing `.env` contents, produce the contents to write on
// MindsHub sign-in. Strips every prior MINDS_KEYS line and re-adds the
// credential + provider keys with fresh values.
//
// Deliberately writes NO ANTON_PLANNING_MODEL / ANTON_CODING_MODEL, and (as of
// ENG-739) no longer strips them either — MINDS_KEYS omits both model keys, so
// any model line the user set for the standalone CLI survives re-login. Pinning
// `latest:sonnet` / `latest:haiku` here (an ENG-436-era guard against
// deprecated-alias 500s) became fatal once tier gating shipped: it made every
// sign-in an *explicit* model pick, so the server's enabled-aware default
// (which only fills an unset model) could never steer a free-tier user to a
// model their plan allows → first message 403s (ENG-597/ENG-739). Leaving the
// model unset for a fresh user lets the server resolve the right model per tier
// (paid → sonnet/haiku, free → first enabled).
export function buildMindsEnvContent(existing: string, apiKey: string, host: string): string {
  const lines = existing.split('\n')
    .filter(l => !MINDS_KEYS.some(k => l.startsWith(k + '=')));
  lines.push(
    'ANTON_MINDS_ENABLED=true',
    `ANTON_MINDS_URL=${host}`,
    `ANTON_MINDS_API_KEY=${apiKey}`,
    'ANTON_PLANNING_PROVIDER=minds-cloud',
    'ANTON_CODING_PROVIDER=minds-cloud',
  );
  return lines.filter(Boolean).join('\n') + '\n';
}

// Renewal-only .env rewrite (ENG-498): swap the credential line and
// nothing else. buildMindsEnvContent is deliberately NOT reused here —
// it re-asserts ANTON_MINDS_ENABLED and the provider lines, which would
// hijack the provider selection of a user who switched to BYOK after
// signing in. Same filter+push shape as the sign-in writer.
export function replaceMindsApiKeyLine(existing: string, apiKey: string): string {
  const lines = existing.split('\n')
    .filter((l) => !l.startsWith('ANTON_MINDS_API_KEY='));
  lines.push(`ANTON_MINDS_API_KEY=${apiKey}`);
  return lines.filter(Boolean).join('\n') + '\n';
}

// The DB setting keys a MindsHub sign-in must push, and ONLY these. The
// server's one-time `.env`→DB migration is sentinel-guarded and won't re-run,
// so a freshly-minted key / URL / provider selection has to be written
// explicitly after login. Provider values are the DB enum form (`minds_cloud`,
// underscore) — same as the picker writes via `PROVIDER_TO_SERVER`.
//
// Deliberately excludes planning_model / coding_model (ENG-739). The old sign-
// in path POSTed the whole `.env` to `/settings/raw`, which re-reads the full
// `.env` from disk and syncs EVERY recognised key — so a legacy `.env` model
// line (or a stale login-written `latest:` pin) would clobber a model the user
// just fixed via the picker, with no way to leave the model untouched. Writing
// only these keys leaves the DB's model rows (and any picker fix) alone.
export function mindsSignInSettingWrites(apiKey: string, host: string): Array<{ key: string; value: string }> {
  return [
    { key: 'minds_api_key', value: apiKey },
    { key: 'minds_url', value: host },
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

export async function writeMindsKeyToEnvAndRestart(apiKey: string): Promise<void> {
  const homeDir = coworkHome();
  // ~/.cowork normally exists by the time SSO finalize runs (the server
  // creates it on boot), but if the server failed to start the finalize
  // write would ENOENT and the user's freshly-minted key is lost.
  if (!fs.existsSync(homeDir)) {
    fs.mkdirSync(homeDir, { recursive: true });
  }
  const envPath = coworkEnvPath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  // Atomic + lock-tolerant write that wedged onboarding on Windows (ENG-1209).
  // NOT fatal on the installed path: the DB sync below is the authoritative
  // credential store, so an exhausted-retry .env failure must not abort there and
  // strand the user with an already-revoked key — that abort WAS the wedge. But
  // on the pre-install path there IS no DB sync (early-return below), so .env is
  // the only store and a failed write must still surface — swallowing it there
  // would report success with the credential saved nowhere.
  let envWriteError: unknown = null;
  try {
    await writeEnvFileAtomic(envPath, buildMindsEnvContent(existing, apiKey, MINDS_API_HOST));
    // Owner-only perms (plaintext API key); best-effort, a no-op on Windows.
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
    const existing: any[] = Array.isArray(state.preferences.providers) ? state.preferences.providers : [];
    const mindsEntry = existing.find((p: any) => p?.type === 'minds-cloud') ?? { type: 'minds-cloud' };
    mindsEntry.isDefault = true;
    state.preferences.providers = [mindsEntry];
    fs.mkdirSync(coworkHome(), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch (error) {
    console.warn('[minds-auth] failed to set provider state', error);
  }

  // Only restart the server if it's already installed. On a fresh install the
  // server isn't available yet — the setup wizard will start it after install
  // completes, at which point handleInstallComplete syncs the credentials.
  const { antonInstalled } = await checkInstallStatus();
  if (!antonInstalled) {
    // No DB to fall back to on this path — .env IS the store here, so a failed
    // write is fatal and must surface rather than reporting a false success.
    if (envWriteError) throw envWriteError;
    console.log('[minds-auth] server not installed yet — skipping restart; setup will sync creds after install');
    return;
  }

  await stopServer();
  await startServer();

  // Push the freshly-minted credential + provider selection to the server's
  // SQLite DB. The one-time .env → DB migration (migrate_env_to_db) is
  // sentinel-guarded and won't re-run, so values written to .env after initial
  // setup never reach the DB unless we explicitly push them.
  //
  // ENG-739: use individual `PUT /settings/{key}` writes for exactly the
  // sign-in fields — NOT `POST /settings/raw`. That endpoint re-reads the full
  // .env from disk and syncs EVERY recognised key, so a legacy/stale model
  // line in .env would clobber a model the user just fixed via the picker.
  // Writing only these keys leaves the DB's model rows untouched.
  if (isServerRunning() || isServerStarting()) {
    const port = getServerPort();
    // Order matters (mindsSignInSettingWrites lists the credential first): if
    // the minds_api_key write fails, ABORT before flipping the provider to
    // minds-cloud. provisionAntonApiKey already revoked the old key, so a
    // partial "provider=minds-cloud + no/stale key" state would leave
    // config_ready true while every message 401s. Bailing keeps the prior
    // config intact until the next sign-in retries the whole sequence.
    for (const { key, value } of mindsSignInSettingWrites(apiKey, MINDS_API_HOST)) {
      let ok = false;
      try {
        // authHeader(): main-process fetch — the webRequest injection hook
        // only covers renderer requests, so this must carry the server
        // bearer token itself when COWORK_REQUIRE_AUTH=true.
        const res = await timedFetch(`http://127.0.0.1:${port}/api/v1/settings/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ value }),
        });
        ok = res.ok;
        if (!res.ok) {
          console.warn(`[minds-auth] settings PUT ${key} returned`, res.status);
        }
      } catch (error) {
        console.warn(`[minds-auth] failed to write ${key} to server DB`, error);
      }
      if (!ok && key === 'minds_api_key') {
        console.warn('[minds-auth] aborting settings sync — credential write failed; leaving prior config intact');
        break;
      }
    }

    // Verify the server is actually configured after the writes.
    // If the writes failed silently (DB not updated), config_ready will
    // still be false and the user would appear unconfigured after login.
    try {
      const healthRes = await timedFetch(`http://127.0.0.1:${port}/api/v1/health/`);
      if (healthRes.ok) {
        const health = await healthRes.json() as Record<string, unknown>;
        if (!health.config_ready) {
          console.warn('[minds-auth] config_ready is false after settings writes — restarting server');
          await stopServer();
          await startServer();
        }
      }
    } catch (error) {
      console.warn('[minds-auth] health check after settings writes failed:', error);
    }
  }
}

let _refreshTimer: NodeJS.Timeout | null = null;

// How long to wait before retrying after a transient refresh failure.
// Constant (no backoff): one loopback-cheap POST per minute while the
// network is down, and the session converges to signed-in the moment
// connectivity returns instead of waiting for the next app launch.
const REFRESH_RETRY_DELAY_MS = 60_000;

export function scheduleRefresh(expiresInSeconds: number): void {
  scheduleRefreshIn(Math.max((expiresInSeconds - 60) * 1000, 10_000));
}

export function scheduleRefreshRetry(): void {
  scheduleRefreshIn(REFRESH_RETRY_DELAY_MS);
}

export function cancelScheduledRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = null;
}

function scheduleRefreshIn(delayMs: number): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // refreshTokensOnly re-arms the timer itself on every outcome that
  // warrants one (ok → next expiry window, transient → retry delay), so
  // the chain never dies after a single failure — the pre-ENG-761 timer
  // ran silentRefresh once and never retried.
  _refreshTimer = setTimeout(() => { void refreshTokensOnly(); }, delayMs);
}

// ── Per-device key lifecycle (ENG-498) ────────────────────────────
//
// Boot + daily watch over THIS device's key. While the auth-service TTL
// is disabled every key has expiry_date null and this is a no-op listing
// call; once ops enables the TTL, installs renew ahead of the deadline
// instead of 401-ing at it (the ENG-440 bug, time-delayed). A key that
// is MISSING (not expired — absent) is deliberately left alone: that is
// plausibly a console revocation, and silently re-minting would undo it.

const KEY_LIFECYCLE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let _keyLifecycleTimer: NodeJS.Timeout | null = null;
let _inflightKeyLifecycle: Promise<void> | null = null;

export function startKeyLifecycleChecks(): void {
  cancelKeyLifecycleChecks();
  void runKeyLifecycleCheck();
  _keyLifecycleTimer = setInterval(() => { void runKeyLifecycleCheck(); }, KEY_LIFECYCLE_INTERVAL_MS);
}

export function cancelKeyLifecycleChecks(): void {
  if (_keyLifecycleTimer) clearInterval(_keyLifecycleTimer);
  _keyLifecycleTimer = null;
}

// Single-flight like refreshTokensOnly: a boot check racing the first
// interval tick must not double-mint.
export function runKeyLifecycleCheck(): Promise<void> {
  if (!_inflightKeyLifecycle) {
    _inflightKeyLifecycle = doKeyLifecycleCheck()
      .catch((e: any) => { console.warn('[minds-auth] key lifecycle check failed:', e?.message || e); })
      .finally(() => { _inflightKeyLifecycle = null; });
  }
  return _inflightKeyLifecycle;
}

function tokenSubject(token: string | null): string | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload?.sub === 'string' ? payload.sub : null;
}

async function doKeyLifecycleCheck(): Promise<void> {
  // Signed-out sessions have nothing to renew. Don't force a refresh
  // round-trip when there is no session at all.
  if (!getAccessToken() && !getRefreshToken()) return;
  // The settings PUT in commitRenewedKey is the ONLY durable commit path
  // (DB rows outrank .env in the server's settings chain, and the
  // env→DB migration is sentinel-guarded — it never re-runs). With no
  // server to PUT to, minting now would strand the new key unwritten
  // until some later tick; simpler and safer to skip the whole tick and
  // let the next one retry once the server is up.
  if (!isServerRunning() && !isServerStarting()) {
    console.log('[minds-auth] server not running — no commit path — skipping this tick');
    return;
  }
  let token = getAccessToken();
  if (!token || isAccessTokenExpired()) {
    const result = await refreshTokensOnly();
    if (result.status !== 'ok') return;
    token = result.token;
  }
  // Whose key we are renewing. Compared again before the commit: benign
  // refreshes rotate the token string but keep `sub`, so this aborts
  // exactly when a logout or different-user login landed mid-renewal.
  // (getTokenStoreVersion is unsuitable here — provisioning's own
  // org-switch refreshes bump it, which would abort every renewal that
  // needs the personal-org fallback.)
  const renewingFor = tokenSubject(token);
  if (!renewingFor) return;

  const keyName = antonKeyName();
  // revoked !== true: auth's DELETE is a soft delete and the list keeps the
  // row, so a console-revoked key still lists with its expiry_date. Filtering
  // it out makes it genuinely look absent — renewing it would quietly undo an
  // admin's deliberate revocation (and an expired revoked key would
  // "self-heal" the moment its TTL lapsed).
  const own = (await listExistingKeys(token)).filter((k) => k?.name === keyName && k.revoked !== true);
  if (own.length === 0) return;
  // Duplicates exist after a renewal (old key rides to expiry) — the
  // newest one is the live credential and drives the decision.
  const newest = own.reduce((a, b) =>
    (Date.parse(b.created ?? '') || 0) > (Date.parse(a.created ?? '') || 0) ? b : a);
  if (!shouldRenewKey(newest.created, newest.expiry_date, Date.now())) return;

  console.log('[minds-auth] device key expired or near expiry — re-minting');
  let result = await provisionAntonApiKey(token, { deleteExistingKey: false });
  if (!result.key && result.limitReached) {
    // At the active-key cap the no-delete renewal can never succeed and
    // would fail identically every tick until the 401 deadline, so retry
    // once with this device's own prior key deleted. The trade is not
    // free: the delete runs BEFORE the mint, so if the retry's mint then
    // fails (network, 5xx, token expiry mid-flight) the device holds no
    // live key — and since revoked rows are filtered out above, the next
    // tick takes the "missing ⇒ don't silently re-mint" branch, so the
    // only in-product recovery is a re-sign-in until the local-vs-remote
    // key-identity heal (ENG-498 enablement precondition) ships. Accepted:
    // it needs the cap AND a second-mint failure, and this path can't
    // fire at all until the TTL is enabled — which is gated on that heal.
    console.warn('[minds-auth] key renewal hit the active-key cap — retrying once with own prior key deleted');
    result = await provisionAntonApiKey(token, { deleteExistingKey: true });
  }
  if (!result.key) {
    console.warn('[minds-auth] key renewal mint failed:',
      result.error || (result.upgradeRequired ? 'upgrade required' : 'no key returned'));
    return;
  }
  if (tokenSubject(getAccessToken()) !== renewingFor) {
    // Deliberately no rollback here: a logout/different-user login is a
    // separate concern from a failed commit, and the new session may
    // already be relying on whatever it just did — the TTL reaps this
    // key on its own if it truly goes unused.
    console.warn('[minds-auth] session changed during key renewal — discarding minted key');
    return;
  }
  await commitRenewedKey(token, result.key, result.prefix);
}

// Hot-swap the renewed credential. The settings PUT goes FIRST and is the
// AUTHORITATIVE commit: in cowork-server, DB rows outrank .env in the
// settings chain, and the one-time env→DB migration is sentinel-guarded
// and never re-runs — so a key that only reaches .env never reaches the
// app. .env is written only after the PUT lands; it's just the
// standalone-CLI's copy. If the PUT is skipped or fails, roll the mint
// back (delete the just-minted key) so the account's "newest key" reverts
// to the old one and the next tick retries the whole renewal statelessly
// — recovery that works even across an app restart.
// Deliberately NOT writeMindsKeyToEnvAndRestart — no server restart (the
// settings cache invalidates on PUT; in-flight sessions keep the old key,
// which stays valid until its own expiry), and no provider flips (a user
// who switched to BYOK keeps their selection).
async function commitRenewedKey(accessToken: string, apiKey: string, prefix: string | undefined): Promise<void> {
  // Roll back with the CURRENT store token, not the one captured at the
  // top of doKeyLifecycleCheck: provisionAntonApiKey may have minted under
  // an org-switched token (org-switch / personal-org fallback), and the
  // auth-service's DELETE is org-scoped — deleting with the stale token
  // 404s. refreshAfterOrgSwitch persists the switched token via
  // saveTokens, so getAccessToken() carries the right org claim by now;
  // fall back to the passed-in token only if the store emptied mid-flight.
  const rollbackMint = async (): Promise<void> => {
    if (prefix) await deleteKeyByPrefix(getAccessToken() ?? accessToken, prefix);
  };

  // Re-check here too: the boot-time gate in doKeyLifecycleCheck can go
  // stale across the mint's network round-trip if the sidecar goes down
  // mid-renewal.
  if (!isServerRunning() && !isServerStarting()) {
    console.warn('[minds-auth] server no longer available for renewal commit — rolling back minted key, will retry next tick');
    await rollbackMint();
    return;
  }
  const port = getServerPort();
  try {
    // authHeader(): main-process fetches never pass through the renderer's
    // webRequest injection hook, so with COWORK_REQUIRE_AUTH=true a bare PUT
    // 401s — which here would mean mint → rollback → retry, silently, every
    // tick forever.
    const res = await timedFetch(`http://127.0.0.1:${port}/api/v1/settings/minds_api_key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ value: apiKey }),
    });
    if (!res.ok) {
      console.warn('[minds-auth] renewal settings PUT returned', res.status, '— rolling back minted key, will retry next tick');
      await rollbackMint();
      return;
    }
  } catch (error) {
    console.warn('[minds-auth] failed to write renewed key to server DB — rolling back minted key, will retry next tick', error);
    await rollbackMint();
    return;
  }

  // DB is authoritative and already correct at this point — a failure
  // here is not a renewal failure, only a stale standalone-CLI copy.
  try {
    const homeDir = coworkHome();
    if (!fs.existsSync(homeDir)) {
      fs.mkdirSync(homeDir, { recursive: true });
    }
    const envPath = coworkEnvPath();
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
    // Atomic writer (ENG-1209): the renewal runs while the live server holds
    // .env open, which is exactly the Windows share-mode EPERM this fixes.
    await writeEnvFileAtomic(envPath, replaceMindsApiKeyLine(existing, apiKey));
  } catch (error) {
    console.warn('[minds-auth] renewed key committed to server DB but failed to write .env (CLI copy stale)', error);
  }
}
