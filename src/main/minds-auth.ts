import { saveTokens, getRefreshToken } from './token-store';
import { stopServer, startServer, isServerRunning, isServerStarting, getServerPort } from './server-process';
import { checkInstallStatus } from './installer';
import { coworkHome, coworkEnvPath, coworkStatePath } from './cowork-home';
import { getInstallationId } from './installation-id';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const KEYCLOAK_BASE = 'https://auth.mindshub.ai/auth';
const KEYCLOAK_REALM = 'mindsdb';
// `anton-desktop` is the native Keycloak client used for the loopback
// PKCE flow in the desktop app.
const KEYCLOAK_CLIENT_ID = 'anton-desktop';
const TOKEN_URL = `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

// Django auth-service that issues MindsHub API keys. The Keycloak JWT
// alone is NOT a valid LLM credential — the gateway only accepts an
// `mdb_*` API key minted here. We exchange the JWT for a key once at
// finalize time and stash the key in ~/.anton/.env; the JWT itself
// never reaches the LLM gateway.
const AUTH_SERVICE_URL = 'https://auth.mindshub.ai/v1';

// MindsHub LLM gateway base URL (OpenAI-compatible). Promote to
// api.mindshub.ai when the desktop app moves to prod.
const MINDS_LLM_BASE_URL = 'https://api.mindshub.ai/v1';

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

function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
}

// True iff the user has previously finalized onboarding with Minds as
// their LLM. Lets the boot-time silent refresh decide whether a new
// access token is worth pulling — the env file is the source of truth
// for the LLM credential, the JWT only matters for auth-service calls.
function envHasMindsCommitted(): boolean {
  const envPath = coworkEnvPath();
  if (!fs.existsSync(envPath)) return false;
  const content = fs.readFileSync(envPath, 'utf-8');
  return /^ANTON_MINDS_API_KEY=/m.test(content);
}

// Refresh tokens only — no env writes, no server restart. Used during
// onboarding (e.g. after Stripe checkout, when we re-check roles) and
// from the boot path. The LLM env credential is a long-lived API key
// minted by the auth-service and isn't tied to the JWT lifetime, so
// refreshing the JWT no longer needs to touch env.
export async function refreshTokensOnly(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
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
    if (!res.ok) return null;
    const data = await res.json() as { access_token: string; expires_in?: number; refresh_token?: string };
    saveTokens(data.access_token, data.expires_in ?? 3600, data.refresh_token ?? refreshToken);
    scheduleRefresh(data.expires_in ?? 3600);
    return data.access_token;
  } catch {
    return null;
  }
}

// Boot-time entry point. Only worth running when the user already
// finalized onboarding (env has the committed API key) — otherwise the
// in-memory token would just sit unused. Returns true iff we refreshed.
export async function silentRefresh(): Promise<boolean> {
  if (!envHasMindsCommitted()) return false;
  return Boolean(await refreshTokensOnly());
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
// and is saved back into the store so subsequent calls (and
// silentRefresh) see the org-aware token. Identical mechanics to
// refreshTokensOnly — kept as a named alias for call-site clarity.
const refreshAfterOrgSwitch = refreshTokensOnly;

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

  const orgs = await listOrgCandidates(accessToken, userId, payload);
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
      ent?.permissions?.agents?.use,
      ent?.permissions?.api_keys?.create,
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
        'Sign in at console.dev.mindshub.ai once to create or join an organization, then try again.',
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
        norm.permissions.agents.use,
        norm.permissions.api_keys.create,
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
  'ANTON_PLANNING_MODEL',
  'ANTON_CODING_MODEL',
  'ANTON_ANTHROPIC_API_KEY',
  'ANTON_OPENAI_API_KEY_CUSTOM',
  'ANTON_GEMINI_API_KEY',
];

// Writes the MindsHub LLM credentials to ~/.anton/.env (merge, not
// overwrite) and restarts the python server so it picks them up.
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
  const lines = existing.split('\n')
    .filter(l => !MINDS_KEYS.some(k => l.startsWith(k + '=')));
  lines.push(
    'ANTON_MINDS_ENABLED=true',
    `ANTON_MINDS_URL=${MINDS_LLM_BASE_URL.replace(/\/v1$/, '')}`,
    `ANTON_MINDS_API_KEY=${apiKey}`,
    'ANTON_PLANNING_PROVIDER=minds-cloud',
    'ANTON_CODING_PROVIDER=minds-cloud',
    'ANTON_PLANNING_MODEL=latest:sonnet',
    'ANTON_CODING_MODEL=latest:haiku',
  );
  fs.writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n', 'utf-8');

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
    console.log('[minds-auth] server not installed yet — skipping restart; setup will sync creds after install');
    return;
  }

  await stopServer();
  await startServer();

  // Sync the .env values we just wrote to the server's SQLite DB.
  // The one-time .env → DB migration (migrate_env_to_db) is sentinel-
  // guarded and won't re-run, so credentials written to .env after
  // initial setup never reach the DB unless we explicitly push them.
  // POST /api/v1/settings/raw merges and calls sync_env_vars_to_db.
  if (isServerRunning() || isServerStarting()) {
    const port = getServerPort();
    const envContent = fs.readFileSync(coworkEnvPath(), 'utf-8');
    try {
      const syncRes = await timedFetch(`http://127.0.0.1:${port}/api/v1/settings/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: envContent }),
      });
      if (!syncRes.ok) {
        console.warn('[minds-auth] settings/raw sync returned', syncRes.status);
      }
    } catch (error) {
      console.warn('[minds-auth] failed to sync .env to server DB', error);
    }

    // Verify the server is actually configured after the sync.
    // If the sync failed silently (DB not updated), config_ready will
    // still be false and the user would appear unconfigured after login.
    try {
      const healthRes = await timedFetch(`http://127.0.0.1:${port}/api/v1/health/`);
      if (healthRes.ok) {
        const health = await healthRes.json() as Record<string, unknown>;
        if (!health.config_ready) {
          console.warn('[minds-auth] config_ready is false after sync — restarting server');
          await stopServer();
          await startServer();
        }
      }
    } catch (error) {
      console.warn('[minds-auth] health check after sync failed:', error);
    }
  }
}

let _refreshTimer: NodeJS.Timeout | null = null;

export function scheduleRefresh(expiresInSeconds: number): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  const delay = Math.max((expiresInSeconds - 60) * 1000, 10_000);
  _refreshTimer = setTimeout(silentRefresh, delay);
}
