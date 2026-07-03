// Desktop PostHog analytics — fire-and-forget event capture.
//
// Uses the PostHog Capture API directly (no posthog-js dependency).
// Identity is stitched via the Keycloak JWT's `sub` claim, which is the
// same user_id used by the web console (ENG-227 / ENG-235).
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

// True when the signed-in user is a mindsdb.com account — set from the JWT
// `email` claim when the distinct_id is decoded (see getDistinctId).
const INTERNAL_EMAIL_DOMAIN = '@mindsdb.com';
let _cachedIsInternal = false;

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
    // Cache for 5 minutes — tokens refresh on a longer cycle.
    _cacheExpiry = Date.now() + 5 * 60 * 1000;
    return _cachedDistinctId;
  } catch {
    return null;
  }
}

// Fire-and-forget POST to PostHog Capture API. Never throws, never blocks.
// Returns a promise that resolves true only when the POST actually succeeded —
// one-shot callers (trackAppInstalled) rely on this so they don't mark
// themselves done before the event is delivered. Other callers ignore it.
function capture(event, properties = {}) {
  if (!POSTHOG_KEY) return Promise.resolve(false);
  // CI/QA traffic never reaches PostHog — keeps the funnel cohort clean without
  // every query having to remember an exclusion filter.
  if (isCi()) return Promise.resolve(false);
  return getDistinctId().then((distinctId) => {
    if (!distinctId) return false;
    const body = JSON.stringify({
      api_key: POSTHOG_KEY,
      event,
      distinct_id: distinctId,
      properties: {
        ...properties,
        surface: SURFACE,
        is_internal: _cachedIsInternal,
        $lib: 'cowork-desktop',
      },
      timestamp: new Date().toISOString(),
    });
    return fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then((res) => res.ok).catch(() => false);
  }).catch(() => false);
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

// Desktop app installed — fired once per install on the first authenticated
// launch. A localStorage marker keeps it idempotent across restarts; we wait
// for an identity so the event isn't dropped before the user signs in.
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
