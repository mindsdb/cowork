import { saveTokens, getRefreshToken, clearTokens, getTokenStoreVersion } from './token-store';
import { getInstallationId } from './installation-id';
import { retryOnTransientLock } from './fs-retry';
import {
  MINDS_KEYCLOAK_BASE,
  MINDS_AUTH_SERVICE_URL as AUTH_SERVICE_URL,
  MINDS_CONSOLE_HOST,
} from './minds-urls';
import * as fs from 'fs';
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
export async function endKeycloakSession(): Promise<void> {
  const refreshToken = getRefreshToken();
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
  // True iff the auth-service rejected the request because the user
  // lacks the entitlement to mint LLM keys (free tier). Surfaced to
  // the renderer so it can route to the paywall instead of treating
  // this as a generic failure.
  upgradeRequired?: boolean;
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
async function listExistingKeys(accessToken: string): Promise<{ name?: string; prefix?: string }[]> {
  const collected: { name?: string; prefix?: string }[] = [];
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
        collected.push(...(body as { name?: string; prefix?: string }[]));
        break;
      }
      const results = (body as { results?: unknown }).results;
      if (Array.isArray(results)) {
        collected.push(...(results as { name?: string; prefix?: string }[]));
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
    await timedFetch(`${AUTH_SERVICE_URL}/api-keys/${encodeURIComponent(prefix)}/`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // best-effort cleanup — proceed with the new key creation regardless
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

export async function provisionAntonApiKey(initialToken: string): Promise<ProvisionResult> {
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
  const existing = await listExistingKeys(provisionToken);
  for (const entry of existing) {
    if (entry?.name === keyName && entry.prefix) {
      await deleteKeyByPrefix(provisionToken, entry.prefix);
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
      if (data?.key) return { key: data.key };
      return { error: 'Auth-service did not return an API key value.' };
    }
    type ErrorBody = { code?: string; detail?: string; error?: string; message?: string };
    let body: ErrorBody | null = null;
    try { body = await res.json() as ErrorBody; } catch { /* not JSON */ }
    if (res.status === 402 || body?.code === 'upgrade_required') {
      return { upgradeRequired: true };
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

// Durable `.env` write for Windows. Since ENG-1127 Phase B the client no longer
// writes `.env` on sign-in (the server mirrors the DB out for the standalone
// anton CLI); this helper survives only for the sign-out credential scrub
// (logout-env.ts), which still edits `.env` directly. The server holds this same
// file open, so the rename can hit the EPERM share-mode lock that wedged
// onboarding (ENG-1209). The fix is the temp-write-then-atomic-rename with retry
// — the write lands on a fresh, unlocked path and only the rename contends with
// the lock. Two things matter:
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
