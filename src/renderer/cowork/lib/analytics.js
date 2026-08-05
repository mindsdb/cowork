// Desktop PostHog analytics: fire-and-forget event capture via the Capture API
// directly (no posthog-js dependency).
//
// Identity model (ENG-537): events fire under a stable anonymous device id
// before sign-in, then merge into the Keycloak-`sub`-keyed account on first
// login via a PostHog `$identify` alias, so the install -> signup -> paying
// funnel stays complete for users who install before authenticating. Account
// attributes (email, org, tier, is_internal) ride `$set` on every authenticated
// event so desktop-only users, who never open the web console, still carry
// joinable identity.
//
// Internal traffic (ENG-385 / ENG-672): CI/QA sessions are dropped entirely; a
// signed-in mindsdb.com email or Keycloak `staff` role is tagged is_internal so
// it can be filtered out of the funnel. Before identity resolves the flag is
// unknown and omitted, never sent as false, so anonymous traffic does not read
// as external.
//
// Every product event this module emits is registered in EVENTS below.

import { host } from '../../platform/host';

// The single register of product events, so every event and its own properties
// are visible at a glance. capture() additionally stamps surface, app_version,
// device_id, and (once identity resolves) is_internal + a `$set` person update
// on all of them. `$identify` is a PostHog protocol event, not a product event,
// so it lives inline in the merge rather than here.
const EVENTS = {
  DATA_SOURCE_CONNECTED: 'data_source_connected', // { source_type }
  ARTIFACT_BUILT:        'artifact_built',         // { artifact_type }
  ARTIFACT_PUBLISHED:    'artifact_published',     // { artifact_id, visibility }
  AGENT_SESSION_STARTED: 'agent_session_started',  // {}
  FIRST_QUERY:           'first_query',            // {}  once per user (ENG-501)
  FIRST_RESPONSE:        'first_response',         // { outcome: 'success'|'error', reason } once per user (ENG-736)
  TOKEN_CAP_HIT:         'token_cap_hit',          // {}  upgrade-intent signal (ENG-385)
  HARNESS_SWAPPED:       'harness_swapped',        // { from, to }
  APP_INSTALLED:         'app_installed',          // {}  desktop, once per install
  BOOT_SCREEN_RESOLVED:  'boot_screen_resolved',   // { target, anton_installed, server_deps_ready } desktop, per launch (ENG-921)
};

const POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_KEY =
  typeof import.meta !== 'undefined'
    ? import.meta.env.VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN || ''
    : '';

const SURFACE = host.isElectron ? 'desktop' : 'web';
// `$lib` is derived from the surface so web-SPA events read as `cowork-web` and
// desktop events as `cowork-desktop`, keeping the shared PostHog project's
// $lib/surface breakdown honest (ENG-1163). It is a client-type label, not an
// environment label; whether an event is *sent* is gated separately below.
const LIB = `cowork-${SURFACE}`;

// Only production builds (`vite build`: packaged desktop, OTA bundle, web SPA)
// emit. The Vite dev server used by `npm run dev` / `npm run dev:web` runs as
// MODE=development, so local dev never pollutes the funnel even when a real
// token sits in a machine-local .env (ENG-1163). Set `?analytics_debug=1` (or
// VITE_ANALYTICS_DEBUG=true) to send from a dev build on purpose. Deployed
// non-prod web is a production build and stays out of the funnel via the CI
// cohort flag instead (isCi()).
const IS_PROD_BUILD =
  typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'production';

// Running UI-bundle version, baked in at build time as __APP_VERSION__ (Vite
// `define`). For OTA clients this is the bundle actually running, not the
// installer shell. `typeof`-guarded so it degrades to undefined outside a real
// build (then dropped by JSON.stringify). Attached to every event as
// `app_version`, and to the person as `last_seen_app_version`. `$set` is
// last-writer-wins, so a straggling event from an older install can overwrite
// it; for "current version" use the latest event's app_version instead.
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;

// ── Session flags ──────────────────────────────────────────────────
// CI-hygiene and debug-logging each resolve to a boolean once (from a build-time
// env var OR a per-session `?query`), then memoize. These are session-level and
// are NOT cleared by resetDeviceIdentity; only per-identity state is.
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

// CI/QA traffic shouldn't pollute the funnel: a build opts out via
// VITE_POSTHOG_MINDSHUB_MAIN_CI, a session via `?ci=1` (mirrors the web hub).
const isCi = memoizedFlag(
  () =>
    (typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_POSTHOG_MINDSHUB_MAIN_CI === 'true') ||
    queryFlag('ci')
);

// Verbose per-event logging for local diagnosis. Off unless
// VITE_ANALYTICS_DEBUG=true or `?analytics_debug=1`, so production stays silent.
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
// clear it wholesale and a reader sees the full surface in one place:
//   isInternal   — null (unknown) until identity resolves, then boolean (ENG-672)
//   personProps  — account attributes for `$set` (ENG-537)
//   deviceId     — stable anonymous id, distinct_id before sign-in
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
// identity in the same tick, before the async localStorage marker is written.
// Entries are cleared on failure so a later event can still retry.
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
// `$identify` alias on login. Mirrors the web console's client uuid.
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
    // localStorage unavailable: volatile per-session id so events still send
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
// useHasFullAccess (ENG-452). An account can carry several tier roles at once (a
// paid user keeps the `free` role too), so a paid/staff role must win over
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
// for both capture() and mergeAnonIntoAccount(). Undefined values are dropped
// by JSON.stringify.
function personSet() {
  return { ...identity.personProps, device_id: getDeviceId(), last_seen_app_version: APP_VERSION };
}

async function getDistinctId() {
  if (identity.distinctId && Date.now() < identity.cacheExpiry) return identity.distinctId;
  try {
    const token = await host.getAccessToken();
    // Identity is unresolved, or has become invalid (e.g. a revoked/expired
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
    // Account attributes for `$set`. Active org is the `activate_organization`
    // claim; tier comes from realm roles via resolvePlanTier. is_internal rides
    // `$set` too, so the internal/external split is a stable person property and
    // pre-login events inherit it via the merge.
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
    // Cache for 5 minutes; tokens refresh on a longer cycle.
    identity.cacheExpiry = Date.now() + 5 * 60 * 1000;
    return identity.distinctId;
  } catch {
    // Any failure resolving identity leaves it unknown (see the token guards
    // above for why the flag must not linger as a stale boolean).
    identity.isInternal = null;
    return null;
  }
}

// Single POST path to the PostHog Capture API. Never throws; resolves true only
// when the POST actually succeeded (2xx). Both capture() and the `$identify`
// merge go through here so the request shape and error handling stay in one
// place. `keepalive` lets an event fired just before quit/navigation flush.
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

// Once per (device -> account), tell PostHog to merge the anonymous device
// person into the identified account person, so pre-login events (notably
// app_installed) follow the user in. PostHog's server-side merge is an
// `$identify` event carrying `$anon_distinct_id`. Idempotent via a localStorage
// marker so it fires once per account, not on every event.
const IDENTITY_MERGED_KEY = 'cowork_identity_merged_sub';
function mergeAnonIntoAccount(sub) {
  if (!POSTHOG_KEY || isCi() || !sub) return;
  if (mergeInFlight.has(sub)) return;
  try {
    if (window.localStorage.getItem(IDENTITY_MERGED_KEY) === sub) return;
  } catch {
    // localStorage unavailable: fall through and attempt the merge anyway.
  }
  const deviceId = getDeviceId();
  // Nothing to merge if there's no distinct device id to alias from.
  if (!deviceId || deviceId === sub) return;
  mergeInFlight.add(sub);
  dlog('$identify merge', { distinct_id: sub, $anon_distinct_id: deviceId });
  postCapture('$identify', sub, {
    $anon_distinct_id: deviceId,
    // Carry device_id onto the person too (via personSet), so the deterministic
    // join key survives even if PostHog declines the person-merge.
    $set: personSet(),
    surface: SURFACE,
    is_internal: identity.isInternal,
  }).then((ok) => {
    if (ok) {
      try {
        window.localStorage.setItem(IDENTITY_MERGED_KEY, sub);
      } catch {
        /* best effort: a re-merge next session is harmless */
      }
    } else {
      mergeInFlight.delete(sub); // non-ok or network error: let a later event retry
    }
  });
}

/**
 * Fire-and-forget capture of one product event. Never throws, never blocks.
 * @param {string} event one of the EVENTS values.
 * @param {object} [properties] event-specific props (see EVENTS for the shape).
 * @returns {Promise<boolean>} true only when the POST actually succeeded, so
 *   one-shot callers (trackAppInstalled, trackFirstQuery) can gate on delivery.
 */
function capture(event, properties = {}) {
  if (!POSTHOG_KEY) {
    dlog('skip', event, '— no POSTHOG_KEY (VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN unset)');
    return Promise.resolve(false);
  }
  if (isCi()) {
    dlog('skip', event, '— CI session');
    return Promise.resolve(false);
  }
  // Suppress dev-server traffic (npm run dev / dev:web) so local sessions with a
  // token in .env don't reach the funnel; opt in with ?analytics_debug=1.
  if (!IS_PROD_BUILD && !isDebug()) {
    dlog('skip', event, '— non-production build (set ?analytics_debug=1 to send)');
    return Promise.resolve(false);
  }
  return getDistinctId()
    .then((distinctId) => {
      // Before sign-in, fall back to the anonymous device id so pre-login events
      // are captured instead of dropped; they merge into the account on first
      // sign-in (see mergeAnonIntoAccount).
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
        // install -> account joins deterministically even without the merge.
        device_id: deviceId,
      };
      // Only stamp is_internal once identity has resolved it; before then it is
      // unknown, and sending false would tag anonymous traffic as external
      // (ENG-672). The person-level `$set` carries it for the account.
      if (identity.isInternal !== null) eventProps.is_internal = identity.isInternal;
      // Account attributes apply only to an identified person; pre-login events
      // inherit these via the `$identify` merge on sign-in.
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
  capture(EVENTS.DATA_SOURCE_CONNECTED, { source_type: sourceType || 'unknown' });
}

export function trackArtifactBuilt(artifactType) {
  capture(EVENTS.ARTIFACT_BUILT, { artifact_type: artifactType || 'unknown' });
}

export function trackArtifactPublished(artifactId, visibility) {
  capture(EVENTS.ARTIFACT_PUBLISHED, {
    artifact_id: artifactId || '',
    visibility: visibility || 'public',
  });
}

export function trackAgentSessionStarted() {
  capture(EVENTS.AGENT_SESSION_STARTED);
}

// The key upgrade-intent signal: a free user hit the token cap. Fired from the
// stream adapter when a turn fails with the `token_limit` code (ENG-385).
export function trackTokenCapHit() {
  capture(EVENTS.TOKEN_CAP_HIT);
}

// User switched the active agent/harness in Settings (e.g. anton -> hermes).
export function trackHarnessSwapped(from, to) {
  capture(EVENTS.HARNESS_SWAPPED, { from: from || 'unknown', to: to || 'unknown' });
}

// Once per user (ENG-501). Mark the localStorage flag only after the event is
// actually delivered (mirrors trackAppInstalled), otherwise an offline first
// query sets the flag, fails to send, and is lost forever. If localStorage is
// unavailable we can't dedupe, so we fire and accept possible duplicates.
const FIRST_QUERY_STORAGE_KEY = 'mdb_first_query_sent';
// Share one delivery attempt across rapid calls; clear after it settles so a
// failed send can still retry on the next query.
let firstQueryInFlight = null;
export function trackFirstQuery() {
  let storageOk = true;
  try {
    if (localStorage.getItem(FIRST_QUERY_STORAGE_KEY)) return Promise.resolve();
  } catch {
    storageOk = false;
  }
  if (firstQueryInFlight) return firstQueryInFlight;
  firstQueryInFlight = capture(EVENTS.FIRST_QUERY)
    .then((sent) => {
      if (sent && storageOk) {
        try {
          localStorage.setItem(FIRST_QUERY_STORAGE_KEY, '1');
        } catch {
          /* best effort */
        }
      }
    })
    .finally(() => {
      firstQueryInFlight = null;
    });
  return firstQueryInFlight;
}

// Map a first query's terminal state to a first_response (outcome, reason), or
// null when there's nothing to record. Pure so it's unit-tested here, not in the
// React send handlers (ENG-736):
//   - failed turn → error (wire code, else config_required for auth, else unknown)
//   - no completion observed → null: outcome unknown, let the next query settle it
//   - completed with a config error in the body → error
//   - any other completed turn → success (empty body is fine, e.g. artifact-only)
export function classifyFirstResponse({ failed = false, completed = false, code, isConfigError = false } = {}) {
  if (failed) {
    return { outcome: 'error', reason: code || (isConfigError ? 'config_required' : 'unknown') };
  }
  if (!completed) return null;
  if (isConfigError) return { outcome: 'error', reason: 'config_required' };
  return { outcome: 'success', reason: undefined };
}

// The activation gate (ENG-736). first_query fires when a first message is sent;
// this fires when it reaches a terminal outcome, so the funnel counts activation
// only on a real answer and can see why one failed. On error, `reason` carries
// the failure code (e.g. model_access_denied) so a failed cohort reads as broken,
// not as weak interest. Once per user; same deliver-then-mark discipline as
// trackFirstQuery so a dropped send can retry.
const FIRST_RESPONSE_STORAGE_KEY = 'mdb_first_response_tracked';
let firstResponseInFlight = null;
export function trackFirstResponse(outcome, reason) {
  let storageOk = true;
  try {
    if (localStorage.getItem(FIRST_RESPONSE_STORAGE_KEY)) return Promise.resolve();
  } catch {
    storageOk = false;
  }
  if (firstResponseInFlight) return firstResponseInFlight;
  // reason is only meaningful on failure; undefined is dropped by JSON.stringify.
  firstResponseInFlight = capture(EVENTS.FIRST_RESPONSE, {
    outcome: outcome === 'success' ? 'success' : 'error',
    reason: outcome === 'success' ? undefined : reason || 'unknown',
  })
    .then((sent) => {
      if (sent && storageOk) {
        try {
          localStorage.setItem(FIRST_RESPONSE_STORAGE_KEY, '1');
        } catch {
          /* best effort */
        }
      }
    })
    .finally(() => {
      firstResponseInFlight = null;
    });
  return firstResponseInFlight;
}

// Desktop app installed, fired once per install on the first healthy launch.
// Captured even before sign-in (under the anonymous device id) so the install
// is recorded at true install time and merged into the account on first login.
// A localStorage marker keeps it idempotent across restarts.
const APP_INSTALLED_KEY = 'cowork_app_installed_tracked';
export async function trackAppInstalled() {
  if (!host.isElectron) return;
  try {
    if (window.localStorage.getItem(APP_INSTALLED_KEY) === '1') return;
  } catch {
    // localStorage unavailable: skip rather than risk repeat sends.
    return;
  }
  // Mark only after delivery: capture() self-gates on identity/CI and resolves
  // false on a transient network failure, so a failed first-launch send won't
  // permanently suppress the install event.
  const sent = await capture(EVENTS.APP_INSTALLED);
  if (!sent) return;
  try { window.localStorage.setItem(APP_INSTALLED_KEY, '1'); } catch { /* best effort */ }
}

// Boot-screen resolution (ENG-921): fires once per launch, before sign-in, with
// the chosen `target` and the local-server install state. It's the only signal
// in the install -> server-ready stretch — app_installed is gated on a healthy
// server, so a user who stalls before then is otherwise invisible. Install state
// is logged independent of `target` so a routing regression (ENG-918: server
// missing, shown 'auth') stays visible. Desktop-only; per-launch, not deduped.
export async function trackBootScreenResolved(target) {
  if (!host.isElectron) return;
  let status;
  try {
    status = await host.checkInstall();
  } catch {
    // Couldn't even check install state — record it as unknown (false) rather
    // than drop the event; "the check failed at boot" is itself a first-run
    // signal worth seeing.
    status = null;
  }
  await capture(EVENTS.BOOT_SCREEN_RESOLVED, {
    target,
    anton_installed: Boolean(status?.antonInstalled),
    server_deps_ready: Boolean(status?.serverDepsReady),
  });
}

// Reset per-device analytics identity on sign-out (ENG-537 review note). A
// different account signing in on the same machine then starts from a fresh
// anonymous device id and merges cleanly; otherwise PostHog refuses to re-merge
// the already-claimed device id into the second account, and pre-login events
// attribute to the shared device. The install marker is deliberately NOT
// cleared: the machine is still installed, so app_installed must not re-fire
// (installs are counted per device, once).
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
    /* localStorage unavailable: the in-memory reset above still applies */
  }
}
