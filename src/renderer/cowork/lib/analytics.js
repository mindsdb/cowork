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
// Internal traffic is kept out of the funnel (ENG-385): CI/QA sessions
// (VITE_POSTHOG_MINDSHUB_MAIN_CI or `?ci=1`) are dropped entirely in capture(), and
// events from a signed-in mindsdb.com user carry `is_internal: true` for a
// PostHog-side cohort filter (the MindsHub main project has no reliable person email
// to filter on, so the flag is derived client-side).

import { host } from '../../platform/host';

const POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_KEY =
  typeof import.meta !== 'undefined'
    ? import.meta.env.VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN || ''
    : '';

const SURFACE = host.isElectron ? 'desktop' : 'web';

// Cohort-hygiene flag. CI/QA traffic shouldn't pollute the funnel: a build
// can opt out via VITE_POSTHOG_MINDSHUB_MAIN_CI, and a session can opt out at runtime
// with `?ci=1` (mirrors the web hub's `VITE_POSTHOG_HUB_CI` / `?ci=1`).
let _cachedIsCi = null;
function isCi() {
  if (_cachedIsCi !== null) return _cachedIsCi;
  let ci = false;
  try {
    if (
      typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_POSTHOG_MINDSHUB_MAIN_CI === 'true'
    ) {
      ci = true;
    }
    if (!ci && typeof window !== 'undefined' && window.location?.search) {
      ci = new URLSearchParams(window.location.search).get('ci') === '1';
    }
  } catch {
    ci = false;
  }
  _cachedIsCi = ci;
  return ci;
}

// Verbose per-event logging for local diagnosis (ENG-537). Off unless
// VITE_ANALYTICS_DEBUG=true or `?analytics_debug=1` — keeps production silent
// while letting a dev watch the capture path in the renderer DevTools console.
let _cachedDebug = null;
function isDebug() {
  if (_cachedDebug !== null) return _cachedDebug;
  let dbg = false;
  try {
    if (
      typeof import.meta !== 'undefined' &&
      import.meta.env?.VITE_ANALYTICS_DEBUG === 'true'
    ) {
      dbg = true;
    }
    if (!dbg && typeof window !== 'undefined' && window.location?.search) {
      dbg = new URLSearchParams(window.location.search).get('analytics_debug') === '1';
    }
  } catch {
    dbg = false;
  }
  _cachedDebug = dbg;
  return dbg;
}
function dlog(...args) {
  if (isDebug()) console.log('[analytics]', ...args);
}

// True when the signed-in user is a mindsdb.com account — set from the JWT
// `email` claim when the distinct_id is decoded (see getDistinctId).
const INTERNAL_EMAIL_DOMAIN = '@mindsdb.com';
let _cachedIsInternal = false;

// Account attributes attached to the PostHog person via `$set` on every
// authenticated event, so desktop events carry email/org and can be joined to
// signup + Stripe (ENG-537). Populated from JWT claims in getDistinctId.
let _cachedPersonProps = {};

// Stable anonymous device id (localStorage), used as the distinct_id before
// sign-in so installs/opens are captured, then merged into the account via a
// `$identify` alias on login (ENG-537). Mirrors the web console's client uuid.
const DEVICE_ID_KEY = 'cowork_device_id';
let _cachedDeviceId = null;
function getDeviceId() {
  if (_cachedDeviceId) return _cachedDeviceId;
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
    _cachedDeviceId = id;
  } catch {
    // localStorage unavailable — volatile per-session id so events still send
    // (they just won't merge across restarts).
    _cachedDeviceId = mint();
  }
  return _cachedDeviceId;
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

// Cached distinct_id to avoid decoding the JWT on every event.
let _cachedDistinctId = null;
let _cacheExpiry = 0;

async function getDistinctId() {
  if (_cachedDistinctId && Date.now() < _cacheExpiry) return _cachedDistinctId;
  try {
    const token = await host.getAccessToken();
    if (!token) return null;
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) return null;
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    _cachedIsInternal = email.endsWith(INTERNAL_EMAIL_DOMAIN);
    _cachedDistinctId = payload.sub;
    // Account attributes for `$set` (ENG-537). The active org lives in the
    // `activate_organization` claim; tier comes from `realm_access.roles` via
    // resolvePlanTier (paid wins over the co-present `free` role). Undefined
    // values are dropped by JSON.stringify.
    const activeOrg = payload.activate_organization;
    const planTier = resolvePlanTier(payload.realm_access?.roles);
    _cachedPersonProps = {
      email: email || undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      organization_id: typeof activeOrg?.id === 'string' ? activeOrg.id : undefined,
      organization_name: typeof activeOrg?.name === 'string' ? activeOrg.name : undefined,
      plan_tier: planTier,
      is_free_tier: planTier === undefined ? undefined : planTier === 'free',
    };
    dlog('identity resolved', {
      distinct_id: _cachedDistinctId,
      is_internal: _cachedIsInternal,
      ..._cachedPersonProps,
    });
    // Fold any pre-login anonymous activity on this device into the account.
    mergeAnonIntoAccount(_cachedDistinctId);
    // Cache for 5 minutes — tokens refresh on a longer cycle.
    _cacheExpiry = Date.now() + 5 * 60 * 1000;
    return _cachedDistinctId;
  } catch {
    return null;
  }
}

// Once per (device → account), tell PostHog to merge the anonymous device
// person into the identified account person, so pre-login events (notably
// app_installed) follow the user in (ENG-537). PostHog's server-side merge is
// an `$identify` event carrying `$anon_distinct_id`. Idempotent via a
// localStorage marker so it fires once per account, not on every event.
const IDENTITY_MERGED_KEY = 'cowork_identity_merged_sub';
// Synchronous guard against the merge firing twice when two events resolve
// identity in the same tick — the localStorage marker is only written after the
// async POST returns, too late to dedupe concurrent callers. Cleared on failure
// so a later event can still retry.
const _mergeInFlight = new Set();
function mergeAnonIntoAccount(sub) {
  if (!POSTHOG_KEY || isCi() || !sub) return;
  if (_mergeInFlight.has(sub)) return;
  try {
    if (window.localStorage.getItem(IDENTITY_MERGED_KEY) === sub) return;
  } catch {
    // localStorage unavailable — fall through and attempt the merge anyway.
  }
  const deviceId = getDeviceId();
  // Nothing to merge if there's no distinct device id to alias from.
  if (!deviceId || deviceId === sub) return;
  _mergeInFlight.add(sub);
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event: '$identify',
    distinct_id: sub,
    properties: {
      $anon_distinct_id: deviceId,
      // Carry device_id onto the person too, so the deterministic join key is
      // available regardless of whether the person-merge lands (ENG-537).
      $set: { ..._cachedPersonProps, device_id: deviceId },
      surface: SURFACE,
      is_internal: _cachedIsInternal,
      $lib: 'cowork-desktop',
    },
    timestamp: new Date().toISOString(),
  });
  dlog('$identify merge', { distinct_id: sub, $anon_distinct_id: deviceId });
  fetch(`${POSTHOG_HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
    .then((res) => {
      dlog('$identify merge ->', res.status);
      if (res.ok) {
        try {
          window.localStorage.setItem(IDENTITY_MERGED_KEY, sub);
        } catch {
          /* best effort — a re-merge next session is harmless */
        }
      } else {
        _mergeInFlight.delete(sub); // let a later event retry
      }
    })
    .catch((err) => {
      dlog('$identify merge failed', err);
      _mergeInFlight.delete(sub); // let a later event retry
    });
}

// Fire-and-forget POST to PostHog Capture API. Never throws, never blocks.
// Returns a promise that resolves true only when the POST actually succeeded —
// one-shot callers (trackAppInstalled) rely on this so they don't mark
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
  return getDistinctId().then((distinctId) => {
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
      is_internal: _cachedIsInternal,
      $lib: 'cowork-desktop',
      // Stable per-install id on every event (pre- and post-login) so
      // install → account can be joined deterministically even if PostHog
      // declines to merge the device person into the account (ENG-537).
      device_id: deviceId,
    };
    // Account attributes only apply to an identified person; pre-login events
    // ride the device id and inherit these via the $identify merge on sign-in.
    if (distinctId) eventProps.$set = { ..._cachedPersonProps, device_id: deviceId };
    const body = JSON.stringify({
      api_key: POSTHOG_KEY,
      event,
      distinct_id: captureId,
      properties: eventProps,
      timestamp: new Date().toISOString(),
    });
    dlog('POST', event, { distinct_id: captureId, identified: Boolean(distinctId) });
    return fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then((res) => {
        dlog('POST', event, '->', res.status);
        return res.ok;
      })
      .catch((err) => {
        dlog('POST', event, 'failed', err);
        return false;
      });
  }).catch((err) => {
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

export function trackFirstQuery() {
  try {
    if (localStorage.getItem(FIRST_QUERY_STORAGE_KEY)) return;
    localStorage.setItem(FIRST_QUERY_STORAGE_KEY, '1');
  } catch {
    // localStorage unavailable — fire anyway and accept possible duplicates
  }
  capture('first_query');
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
  _cachedDeviceId = null;
  _cachedDistinctId = null;
  _cacheExpiry = 0;
  _cachedIsInternal = false;
  _cachedPersonProps = {};
  _mergeInFlight.clear();
  try {
    window.localStorage.removeItem(DEVICE_ID_KEY);
    window.localStorage.removeItem(IDENTITY_MERGED_KEY);
  } catch {
    /* localStorage unavailable — the in-memory reset above still applies */
  }
}
