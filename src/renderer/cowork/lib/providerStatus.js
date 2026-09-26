// Pure derivations for LLM-provider connectivity state, shared by the Settings
// LLM Providers rows and the Model Router picker so the two can't drift. No
// hooks, no JSX — everything here is a function of the persisted status maps
// plus a little view context, which keeps it directly unit-testable without
// rendering SettingsView.

/**
 * @typedef {'wallet_empty'
 *   | 'included_allowance_exhausted'
 *   | 'free_air_daily_spend_fuse_exceeded'
 *   | 'rate_limited'
 *   | 'policy_unavailable'} ProbeDenialCode
 * @typedef {{ code: ProbeDenialCode, resetAt: string | null }} ProbeDenialReason
 *   One entry of the sidecar's `providerStatusReasons` map: why the MindsHub
 *   health probe was refused, in the gateway's own reason words (its
 *   X-MindsHub-Reason header), with the gate's reset instant when it sent one.
 *   cowork-server records one only for a response from the configured MindsHub
 *   host, so a third-party endpoint cannot put one here. This is the one
 *   typedef for that wire entry (api.js's testProviders returns it). A sidecar
 *   newer than this renderer may send a code the union lacks; mindsProbeNotice
 *   and friendlyProviderError show no reason copy for one.
 * @typedef {ProbeDenialReason | null} HeldProbeReason
 *   One type's entry in the renderer's held `providerStatusReasons` map.
 *   SettingsView's runProviderTests writes null for a type the sidecar
 *   classified and found no MindsHub refusal for. A type with no entry has no
 *   classification: its last result came from a sidecar that predates the
 *   map, or it has no result yet.
 * @typedef {'no_credits' | 'allowance_used' | 'paused' | 'slow_down' | 'billing_unavailable'} ProbeNoticeKind
 * @typedef {{ kind: ProbeNoticeKind, resetAt: string | null }} ProbeNotice
 */

// The connectivity facts for one provider type.
//
//   settled       — the status the UI rests at, with the view overrides applied:
//                   MindsHub under an active SSO session always reads 'ok' (its
//                   key lives server-side, so a stale local 'fail' shouldn't
//                   show); any other provider reflects its persisted last-test
//                   result once configured; an unconfigured provider has no
//                   result to show ('untested'). Drives display + structural
//                   decisions (e.g. whether a row shows its key input).
//   raw           — the persisted last-test result, ignoring the SSO/configured
//                   overrides. 'untested' when absent.
//   failed        — raw === 'fail'. Deliberately keyed off raw, not settled:
//                   the picker flags a provider by its recorded result.
//   unconfigured  — carries no usable credential. An active SSO session is
//                   MindsHub's credential (its key lives server-side), so an
//                   SSO-connected MindsHub is never unconfigured.
//   detail        — the persisted status detail string for this type ('' when
//                   absent). Caller decides whether to gate it on `configured`.
//   reason        — the probe's refusal reason for this type
//                   (`ProbeDenialReason`); null when the sidecar classified the
//                   last test and found no MindsHub refusal; undefined when
//                   nothing classified it (a sidecar that predates the field,
//                   or no test yet). mindsProbeNotice treats null and
//                   undefined differently.
//   checking      — a recorded failure is being re-verified, so failure UI
//                   should wait for the fresh result (ENG-1113).
export function deriveProviderStatus(type, {
  providerStatus = {},
  providerStatusDetails = {},
  providerStatusReasons = {},
  configured = false,
  isSsoConnected = false,
  testInProgress = false,
  initialTestDone = true,
} = {}) {
  const raw = providerStatus[type] || 'untested';
  const ssoOk = type === 'minds-cloud' && isSsoConnected;
  const settled = ssoOk ? 'ok'
    : configured ? raw : 'untested';
  const failed = raw === 'fail';
  return {
    raw,
    settled,
    failed,
    unconfigured: !configured && !ssoOk,
    detail: providerStatusDetails[type] || '',
    reason: Object.hasOwn(providerStatusReasons, type) ? (providerStatusReasons[type] || null) : undefined,
    checking: configured && failed && (!initialTestDone || testInProgress),
  };
}

/* The Settings notice each probe refusal gets. The gateway reason passes
   through the sidecar verbatim, so this table is the one place the renderer
   turns it into presentation. */
const PROBE_NOTICE_KIND = {
  wallet_empty: 'no_credits',
  included_allowance_exhausted: 'allowance_used',
  free_air_daily_spend_fuse_exceeded: 'paused',
  rate_limited: 'slow_down',
  policy_unavailable: 'billing_unavailable',
};

/**
 * Which notice a failed MindsHub probe puts under the Settings > Agent role
 * rows, or null for none (the generic "failed its last test" warning then
 * shows instead).
 *
 * With a `reason` from the sidecar, the notice follows its code, and an
 * unknown code gets none. A null `reason` means the sidecar classified the
 * probe and found no MindsHub refusal (an upstream vendor's 429 relayed
 * without an X-MindsHub-Reason, say), so there is no notice. Only an
 * undefined `reason` (a sidecar too old to send the map) takes the legacy
 * detail check: a 402, a 429, or "credit" / "quota" in the detail reads as no
 * credits, exactly as before the reason existed, so an OTA renderer ahead of
 * its sidecar behaves as it always has.
 *
 * @param {{ reason?: ProbeDenialReason | null, detail?: string }} probe
 * @returns {ProbeNotice | null}
 */
export function mindsProbeNotice({ reason, detail = '' } = {}) {
  if (reason) {
    const kind = PROBE_NOTICE_KIND[reason.code];
    return kind ? { kind, resetAt: reason.resetAt || null } : null;
  }
  if (reason === null) return null;
  const text = detail || '';
  const lower = text.toLowerCase();
  const legacyNoCredits = text.includes('402') || text.includes('429')
    || lower.includes('credit') || lower.includes('quota');
  return legacyNoCredits ? { kind: 'no_credits', resetAt: null } : null;
}

/* The sentence for a probe the gateway refused with `rate_limited`. The LLM
   Providers row and the role-row notice (MindsProbeNotice) both show it. */
export const PROBE_RATE_LIMITED_SENTENCE = 'Too many requests too quickly. Wait a moment, then test again.';

/* The sentence for a probe the gateway refused with `policy_unavailable`. The
   LLM Providers row and the role-row notice (MindsProbeNotice) both show it. */
export const PROBE_POLICY_UNAVAILABLE_SENTENCE = 'Billing is temporarily unavailable. Try again in a moment.';

/* The LLM Providers row's one-line error for a refused MindsHub probe, keyed
   by the gateway reason. Shorter than the role-row notice, and it never names
   a refill time: the row has no room to be wrong about one. */
const PROBE_REASON_ROW_COPY = {
  wallet_empty: 'No credits available. Add funds to use MindsHub.',
  included_allowance_exhausted: 'No free MindsHub Air tokens available, and the balance is empty.',
  free_air_daily_spend_fuse_exceeded: 'Free MindsHub Air is paused right now.',
  rate_limited: PROBE_RATE_LIMITED_SENTENCE,
  policy_unavailable: PROBE_POLICY_UNAVAILABLE_SENTENCE,
};

/* Map a raw provider status-detail string to a short, human-readable
   explanation. Returns '' for an empty detail, and falls back to the raw
   detail when nothing more specific matches. A probe refusal `reason`
   (`ProbeDenialReason`) wins over the detail: every MindsHub billing stop and
   the velocity limit share "HTTP 429" or "HTTP 402", and only the reason says
   which one fired. */
export function friendlyProviderError(detail, reason = null) {
  if (reason && PROBE_REASON_ROW_COPY[reason.code]) return PROBE_REASON_ROW_COPY[reason.code];
  if (!detail) return '';
  if (detail === 'missing API key') return 'Add an API key on the right.';
  if (detail === 'missing base URL') return 'Add a base URL on the right.';
  const m = detail.match(/HTTP (\d{3})/);
  if (m) {
    const code = parseInt(m[1], 10);
    if (code === 401) return 'Unauthorized — the API key was rejected.';
    if (code === 403) return 'Forbidden — the API key does not have access.';
    if (code === 404) return 'Endpoint not found — check the base URL.';
    if (code === 429) return 'Rate limited — try again in a moment.';
    if (code >= 500) return `Provider is currently unreachable (HTTP ${code}).`;
    return `Provider rejected the request (HTTP ${code}).`;
  }
  if (detail.startsWith('ConnectError') || detail.startsWith('ConnectTimeout')) {
    return 'Could not reach the provider — network or DNS problem.';
  }
  if (detail.startsWith('ReadTimeout') || detail.startsWith('TimeoutException')) {
    return 'Provider did not respond in time.';
  }
  if (detail.startsWith('SSLError') || detail.includes('certificate')) {
    return 'TLS / certificate problem reaching the provider.';
  }
  return detail;
}
