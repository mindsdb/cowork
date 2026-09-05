// Shared provider-status derivations for Settings and the Model Router picker.

// settled applies display overrides: active SSO makes MindsHub ok, while unconfigured providers are
// untested.
// raw/failed retain the last test verdict; checking postpones failure UI during re-verification.
// An SSO MindsHub key lives server-side and counts as configured. Callers gate detail visibility.
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
