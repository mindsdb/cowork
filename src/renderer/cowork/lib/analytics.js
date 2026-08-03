// Desktop PostHog analytics — fire-and-forget event capture.
//
// Uses the PostHog Capture API directly (no posthog-js dependency).
// Identity is stitched via the Keycloak JWT's `sub` claim, which is the
// same user_id used by the web console (ENG-227 / ENG-235).
//
// Account attributes (email, active org, tier) are attached to the person via
// `$set` on every authenticated event so desktop-only users — who never open
// the web console — still carry joinable identity for the signup→paying funnel
// (ENG-537). Before this the sub was the only identifier, so a desktop-only
// person showed in PostHog as a bare UUID with no email/org to join on.
//
// Pre-login events (notably app_installed) are captured under a stable
// anonymous device id and merged into the account on first sign-in via a
// PostHog `$identify` alias, so the install → signup → paying funnel is
// complete even for users who install before authenticating (ENG-537).
//
// Event contracts (ENG-237):
//   data_source_connected  — { source_type, surface }
//   artifact_built         — { artifact_type, surface }
//   artifact_published     — { artifact_id, visibility, surface }
//   agent_session_started  — { surface }
//   first_query            — { surface }  (once per user, localStorage-gated)
//
// Free-tier funnel events (ENG-385):
//   token_cap_hit          — { surface }            key upgrade-intent signal
//   harness_swapped        — { from, to, surface }
//   app_installed          — { surface }            desktop, once per install
//
// Internal traffic is kept out of the funnel: CI/QA sessions
// (VITE_POSTHOG_MINDSHUB_MAIN_CI or `?ci=1`) are dropped entirely in capture()
// (ENG-385). Signed-in internal users — a mindsdb.com email OR the Keycloak
// `staff` role, mirroring the console's is_staff signal — carry
// `is_internal: true`, set both as an event property and on the person via
// `$set` so a person-level cohort filter is reliable and backfills pre-login
// events like app_installed once the device merges into the account (ENG-672).
// Before identity resolves the flag is unknown, so it is omitted (not sent as
// `false`), otherwise anonymous/pre-login traffic would read as external.

import { host } from '../../platform/host';

const POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_KEY =
  typeof import.meta !== 'undefined'
    ? import.meta.env.VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN || ''
    : '';

const SURFACE = host.isElectron ? 'desktop' : 'web';
const LIB = 'cowork-desktop';

// Running UI-bundle version, baked in at build time as __APP_VERSION__ (Vite
// `define`). For OTA clients this is the bundle actually running, not the
// installer shell. `typeof`-guarded like every __APP_VERSION__ read in the
// renderer, so it degrades to undefined outside a real build (dropped by
// JSON.stringify). Attached to every event as `app_version`, and to the person
// as `last_seen_app_version` — `$set` is last-writer-wins, so a straggling
// event from an older install can overwrite it; it is not authoritative for
// "current version" (use the latest event's app_version for that).
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;

// ── Session flags ──────────────────────────────────────────────────
// Both CI-hygiene and debug-logging resolve to a boolean once (from a build-
// time env var OR a per-session `?query`), then memoize. These are session-
// level and are NOT cleared by resetDeviceIdentity — only per-identity state is.
function memoizedFlag(read) {
  let cached = null;
  return () => {
    if (cached !== null) return cached;
    try {
      cached = Boolean(read());
    } catch {
      cached = false;
    }
    return cached;
  };
}

function queryFlag(param) {
  if (typeof window === 'undefined' || !window.location?.search) return false;
  return new URLSearchParams(window.location.search).get(param) === '1';
}

// CI/QA traffic shouldn't pollute the funnel: a build can opt out via
// VITE_POSTHOG_MINDSHUB_MAIN_CI, and a session can opt out at runtime with
// `?ci=1` (mirrors the web hub's `VITE_POSTHOG_HUB_CI` / `?ci=1`).
const isCi = memoizedFlag(
  () =>
    (typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_POSTHOG_MINDSHUB_MAIN_CI === 'true') ||
    queryFlag('ci')
);

// Verbose per-event logging for local diagnosis (ENG-537). Off unless
// VITE_ANALYTICS_DEBUG=true or `?analytics_debug=1` — keeps production silent
// while letting a dev watch the capture path in the renderer DevTools console.
const isDebug = memoizedFlag(
  () =>
    (typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_ANALYTICS_DEBUG === 'true') ||
    queryFlag('analytics_debug')
);

function dlog(...args) {
  if (isDebug()) console.log('[analytics]', ...args);
}

// ── Identity state ─────────────────────────────────────────────────
// All per-identity mutable state lives in one object so resetDeviceIdentity can
// clear it wholesale and so a reader sees the full surface in one place:
//   isInternal   — null (unknown) until identity resolves, then boolean (ENG-672)
//   personProps  — account attributes for `$set` (ENG-537)
//   deviceId     — stable anonymous id, distinct_id before sign-in (ENG-537)
//   distinctId   — the Keycloak `sub`, cached to avoid decoding the JWT per event
//   cacheExpiry  — epoch ms after which distinctId must be re-resolved
const identity = {
  isInternal: null,
  personProps: {},
  deviceId: null,
  distinctId: null,
  cacheExpiry: 0,
};
// Synchronous guard against the merge firing twice when two events resolve
// identity in the same tick — the localStorage marker is only written after the
// async POST returns, too late to dedupe concurrent callers. Entries are
// cleared on failure so a later event can still retry.
const mergeInFlight = new Set();

const INTERNAL_EMAIL_DOMAIN = '@mindsdb.com';

// Internal iff a mindsdb.com email OR the Keycloak `staff` role is present.
// Pure and role-case-insensitive; returns a boolean, leaving the
// unresolved-identity case to the caller. Exported for direct unit testing.
export function resolveIsInternal(email, roles) {
  if (typeof email === 'string' && email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) return true;
  if (Array.isArray(roles) && roles.some((r) => String(r).toLowerCase() === 'staff')) return true;
  return false;
}

// Stable anonymous device id (localStorage), used as the distinct_id before
// sign-in so installs/opens are captured, then merged into the account via a
// `$identify` alias on login (ENG-537). Mirrors the web console's client uuid.
const DEVICE_ID_KEY = 'cowork_device_id';
function getDeviceId() {
  if (identity.deviceId) return identity.deviceId;
  const mint = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = mint();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    identity.deviceId = id;
  } catch {
    // localStorage unavailable — volatile per-session id so events still send
    // (they just won't merge across restarts).
    identity.deviceId = mint();
  }
  return identity.deviceId;
}

// Decode the JWT payload without a library. Returns null on any error.
function decodeJwtPayload(token) {
  try {
    let payload = token.split('.')[1];
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

// Resolve the plan tier from Keycloak realm roles, mirroring the web console's
// useHasFullAccess (ENG-452). An account can carry several tier roles at once —
// a paid user keeps the `free` role too — so a paid/staff role must win over
// `free`. Precedence: staff > team > pro/pro-hub > free. Returns undefined when
// roles are absent, so the property is omitted rather than guessed.
function resolvePlanTier(roles) {
  if (!Array.isArray(roles)) return undefined;
  const set = new Set(roles.map((r) => String(r).toLowerCase()));
  if (set.has('staff')) return 'staff';
  if (set.has('team')) return 'team';
  if (set.has('pro') || set.has('pro-hub')) return 'pro';
  return 'free';
}

// The person attributes attached to an identified event/merge via `$set`, plus
// the deterministic device_id join key and current app version. Single source
// for both capture() and mergeAnonIntoAccount() (ENG-537). Undefined values are
// dropped by JSON.stringify.
function personSet() {
  return { ...identity.personProps, device_id: getDeviceId(), last_seen_app_version: APP_VERSION };
}

async function getDistinctId() {
  if (identity.distinctId && Date.now() < identity.cacheExpiry) return identity.distinctId;
  try {
    const token = await host.getAccessToken();
    // Identity is unresolved (or has become invalid — e.g. a revoked/expired
    // refresh token, which does not route through resetDeviceIdentity). Drop the
    // cached flag back to unknown so a later anonymous-keyed event omits it
    // rather than replaying a prior session's value (ENG-672).
    if (!token) {
      identity.isInternal = null;
      return null;
    }
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) {
      identity.isInternal = null;
      return null;
    }
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const roles = payload.realm_access?.roles;
    identity.isInternal = resolveIsInternal(email, roles);
    identity.distinctId = payload.sub;
    // Account attributes for `$set` (ENG-537). The active org lives in the
    // `activate_organization` claim; tier comes from `realm_access.roles` via
    // resolvePlanTier (paid wins over the co-present `free` role). is_internal
    // rides `$set` too, so the internal/external split is a stable person
    // property rather than only a per-event flag, and pre-login events inherit
    // it via the merge (ENG-672).
    const activeOrg = payload.activate_organization;
    const planTier = resolvePlanTier(roles);
    identity.personProps = {
      email: email || undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      organization_id: typeof activeOrg?.id === 'string' ? activeOrg.id : undefined,
      organization_name: typeof activeOrg?.name === 'string' ? activeOrg.name : undefined,
      plan_tier: planTier,
      is_free_tier: planTier === undefined ? undefined : planTier === 'free',
      is_internal: identity.isInternal,
    };
    dlog('identity resolved', { distinct_id: identity.distinctId, ...identity.personProps });
    // Fold any pre-login anonymous activity on this device into the account.
    mergeAnonIntoAccount(identity.distinctId);
    // Cache for 5 minutes — tokens refresh on a longer cycle.
    identity.cacheExpiry = Date.now() + 5 * 60 * 1000;
    return identity.distinctId;
  } catch {
    // Any failure resolving identity leaves it unknown — see the token guards
    // above for why the flag must not linger as a stale boolean (ENG-672).
    identity.isInternal = null;
    return null;
  }
}

// Single POST path to the PostHog Capture API. Never throws; resolves true only
// when the POST actually succeeded (2xx). Both capture() and the $identify merge
// go through here so the request shape and error handling stay in one place.
// `keepalive` lets an event fired just before quit/navigation still flush.
function postCapture(event, distinctId, properties) {
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event,
    distinct_id: distinctId,
    properties: { ...properties, $lib: LIB },
    timestamp: new Date().toISOString(),
  });
  return fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then((res) => {
      dlog('POST', event, '->', res.status);
      return res.ok;
    })
    .catch((err) => {
      dlog('POST', event, 'failed', err);
      return false;
    });
}

// Once per (device → account), tell PostHog to merge the anonymous device
// person into the identified account person, so pre-login events (notably
// app_installed) follow the user in (ENG-537). PostHog's server-side merge is
// an `$identify` event carrying `$anon_distinct_id`. Idempotent via a
// localStorage marker so it fires once per account, not on every event.
const IDENTITY_MERGED_KEY = 'cowork_identity_merged_sub';
function mergeAnonIntoAccount(sub) {
  if (!POSTHOG_KEY || isCi() || !sub) return;
  if (mergeInFlight.has(sub)) return;
  try {
    if (window.localStorage.getItem(IDENTITY_MERGED_KEY) === sub) return;
  } catch {
    // localStorage unavailable — fall through and attempt the merge anyway.
  }
  const deviceId = getDeviceId();
  // Nothing to merge if there's no distinct device id to alias from.
  if (!deviceId || deviceId === sub) return;
  mergeInFlight.add(sub);
  dlog('$identify merge', { distinct_id: sub, $anon_distinct_id: deviceId });
  postCapture('$identify', sub, {
    $anon_distinct_id: deviceId,
    // Carry device_id onto the person too (via personSet), so the deterministic
    // join key is available regardless of whether the person-merge lands.
    $set: personSet(),
    surface: SURFACE,
    is_internal: identity.isInternal,
  }).then((ok) => {
    if (ok) {
      try {
        window.localStorage.setItem(IDENTITY_MERGED_KEY, sub);
      } catch {
        /* best effort — a re-merge next session is harmless */
      }
    } else {
      mergeInFlight.delete(sub); // non-ok or network error — let a later event retry
    }
  });
}

// Fire-and-forget event capture. Never throws, never blocks. Returns a promise
// that resolves true only when the POST actually succeeded — one-shot callers
// (trackAppInstalled, trackFirstQuery) rely on this so they don't mark
// themselves done before the event is delivered. Other callers ignore it.
function capture(event, properties = {}) {
  if (!POSTHOG_KEY) {
    dlog('skip', event, '— no POSTHOG_KEY (VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN unset)');
    return Promise.resolve(false);
  }
  // CI/QA traffic never reaches PostHog — keeps the funnel cohort clean without
  // every query having to remember an exclusion filter.
  if (isCi()) {
    dlog('skip', event, '— CI session');
    return Promise.resolve(false);
  }
  return getDistinctId()
    .then((distinctId) => {
      // Fall back to the anonymous device id before sign-in so pre-login events
      // (notably app_installed) are captured instead of dropped; they merge into
      // the account on first sign-in (see mergeAnonIntoAccount).
      const deviceId = getDeviceId();
      const captureId = distinctId || deviceId;
      if (!captureId) {
        dlog('skip', event, '— no identity and no device id');
        return false;
      }
      const eventProps = {
        ...properties,
        surface: SURFACE,
        app_version: APP_VERSION,
        // Stable per-install id on every event (pre- and post-login) so
        // install → account can be joined deterministically even if PostHog
        // declines to merge the device person into the account (ENG-537).
        device_id: deviceId,
      };
      // Only stamp is_internal once identity has resolved it; before then it is
      // unknown, and sending `false` would tag anonymous/pre-login traffic as
      // external (ENG-672). The person-level `$set` below carries it for the
      // account, so pre-login events still roll up correctly after the merge.
      if (identity.isInternal !== null) eventProps.is_internal = identity.isInternal;
      // Account attributes only apply to an identified person; pre-login events
      // ride the device id and inherit these via the $identify merge on sign-in.
      if (distinctId) eventProps.$set = personSet();
      dlog('POST', event, { distinct_id: captureId, identified: Boolean(distinctId) });
      return postCapture(event, captureId, eventProps);
    })
    .catch((err) => {
      dlog('capture failed for', event, err);
      return false;
    });
}

// ── Public event helpers ───────────────────────────────────────────

export function trackDataSourceConnected(sourceType) {
  capture('data_source_connected', { source_type: sourceType || 'unknown' });
}

export function trackArtifactBuilt(artifactType) {
  capture('artifact_built', { artifact_type: artifactType || 'unknown' });
}

export function trackArtifactPublished(artifactId, visibility) {
  capture('artifact_published', {
    artifact_id: artifactId || '',
    visibility: visibility || 'public',
  });
}

export function trackAgentSessionStarted() {
  capture('agent_session_started');
}

// ── Activation event (ENG-501) ──────────────────────────────────────

const FIRST_QUERY_STORAGE_KEY = 'mdb_first_query_sent';

// Once per user. Mark the localStorage flag only after the event is actually
// delivered (mirrors trackAppInstalled) — otherwise an offline first query sets
// the flag, fails to send, and is lost forever. If localStorage is unavailable
// we can't dedupe, so we fire and accept possible duplicates on a later send.
export async function trackFirstQuery() {
  let storageOk = true;
  try {
    if (localStorage.getItem(FIRST_QUERY_STORAGE_KEY)) return;
  } catch {
    storageOk = false;
  }
  const sent = await capture('first_query');
  if (sent && storageOk) {
    try {
      localStorage.setItem(FIRST_QUERY_STORAGE_KEY, '1');
    } catch {
      /* best effort */
    }
  }
}

// ── Free-tier funnel events (ENG-385) ──────────────────────────────

// The key upgrade-intent signal: a free user hit the token cap. Fired from
// the stream adapter when a turn fails with the `token_limit` code — pairs
// with the visible out-of-credits card in ChatView.
export function trackTokenCapHit() {
  capture('token_cap_hit');
}

// User switched the active agent/harness in Settings (e.g. anton → hermes).
export function trackHarnessSwapped(from, to) {
  capture('harness_swapped', { from: from || 'unknown', to: to || 'unknown' });
}

// Desktop app installed — fired once per install on the first healthy launch.
// Captured even before sign-in (under the anonymous device id) so the install
// is recorded at true install time and merged into the account on first login
// (ENG-537). A localStorage marker keeps it idempotent across restarts.
const APP_INSTALLED_KEY = 'cowork_app_installed_tracked';
export async function trackAppInstalled() {
  if (!host.isElectron) return;
  try {
    if (window.localStorage.getItem(APP_INSTALLED_KEY) === '1') return;
  } catch {
    // localStorage unavailable — skip rather than risk repeat sends.
    return;
  }
  // Mark only after the event is actually delivered — capture() self-gates on
  // identity/CI and resolves false on a transient network failure, so a failed
  // first-launch send won't permanently suppress the install event.
  const sent = await capture('app_installed');
  if (!sent) return;
  try { window.localStorage.setItem(APP_INSTALLED_KEY, '1'); } catch { /* best effort */ }
}

// Reset per-device analytics identity on sign-out (ENG-537 review note). A
// different account signing in on the same machine then starts from a fresh
// anonymous device id and merges cleanly — otherwise PostHog refuses to
// re-merge the already-claimed device id into the second account, and pre-login
// events attribute to the shared device. The install marker is deliberately
// NOT cleared: the machine is still installed, so app_installed must not
// re-fire (installs are counted per device, once).
export function resetDeviceIdentity() {
  identity.isInternal = null;
  identity.personProps = {};
  identity.deviceId = null;
  identity.distinctId = null;
  identity.cacheExpiry = 0;
  mergeInFlight.clear();
  try {
    window.localStorage.removeItem(DEVICE_ID_KEY);
    window.localStorage.removeItem(IDENTITY_MERGED_KEY);
  } catch {
    /* localStorage unavailable — the in-memory reset above still applies */
  }
}
