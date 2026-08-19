// Pure derivations for LLM-provider connectivity state, shared by the Settings
// LLM Providers rows and the Model Router picker so the two can't drift. No
// hooks, no JSX — everything here is a function of the persisted status maps
// plus a little view context, which keeps it directly unit-testable without
// rendering SettingsView.

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
//   checking      — a recorded failure is being re-verified, so failure UI
//                   should wait for the fresh result (ENG-1113).
export function deriveProviderStatus(type, {
  providerStatus = {},
  providerStatusDetails = {},
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
    checking: configured && failed && (!initialTestDone || testInProgress),
  };
}

// Map a raw provider status-detail string to a short, human-readable
// explanation. Returns '' for an empty detail, and falls back to the raw
// detail when nothing more specific matches.
export function friendlyProviderError(detail) {
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
