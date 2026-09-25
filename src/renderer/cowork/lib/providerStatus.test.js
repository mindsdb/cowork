import { describe, it, expect } from 'vitest';
import { deriveProviderStatus, friendlyProviderError, mindsProbeNotice } from './providerStatus';

describe('deriveProviderStatus', () => {
  it('rests at the persisted result for a configured provider', () => {
    const st = deriveProviderStatus('anthropic', {
      providerStatus: { anthropic: 'ok' },
      providerStatusDetails: { anthropic: '' },
      configured: true,
    });
    expect(st).toMatchObject({ raw: 'ok', settled: 'ok', failed: false, unconfigured: false });
  });

  it('reports a configured provider whose last test failed', () => {
    const st = deriveProviderStatus('openai', {
      providerStatus: { openai: 'fail' },
      providerStatusDetails: { openai: 'HTTP 401' },
      configured: true,
    });
    expect(st.failed).toBe(true);
    expect(st.settled).toBe('fail');
    expect(st.detail).toBe('HTTP 401');
  });

  it('treats an unconfigured provider as untested, not failed', () => {
    const st = deriveProviderStatus('openai', {
      providerStatus: {},
      providerStatusDetails: {},
      configured: false,
    });
    expect(st).toMatchObject({ settled: 'untested', unconfigured: true, failed: false });
  });

  it('keeps failed keyed off the raw result even when unconfigured', () => {
    // A stale 'fail' persists on a provider whose key was since removed: the
    // settled/display status is untested, but the recorded result is still fail.
    const st = deriveProviderStatus('openai', {
      providerStatus: { openai: 'fail' },
      providerStatusDetails: { openai: 'HTTP 401' },
      configured: false,
    });
    expect(st.raw).toBe('fail');
    expect(st.failed).toBe(true);
    expect(st.settled).toBe('untested');
  });

  it('shows MindsHub as connected under an active SSO session regardless of a stale local fail', () => {
    const st = deriveProviderStatus('minds-cloud', {
      providerStatus: { 'minds-cloud': 'fail' },
      providerStatusDetails: { 'minds-cloud': 'ReadTimeout' },
      configured: true,
      isSsoConnected: true,
    });
    expect(st.settled).toBe('ok');
    // raw/failed still reflect the recorded result — callers that key off the
    // display status won't show it, but the fact is preserved.
    expect(st.raw).toBe('fail');
  });

  it('treats an SSO-connected MindsHub as configured even without a local key', () => {
    // Cloud/multitenancy: SSO session, key held server-side, so `configured`
    // is false — but the picker must not warn "isn't configured".
    const st = deriveProviderStatus('minds-cloud', {
      providerStatus: {},
      providerStatusDetails: {},
      configured: false,
      isSsoConnected: true,
    });
    expect(st.unconfigured).toBe(false);
    expect(st.settled).toBe('ok');
  });

  it('reports an SSO-disconnected MindsHub with no local key as unconfigured', () => {
    const st = deriveProviderStatus('minds-cloud', {
      providerStatus: {},
      providerStatusDetails: {},
      configured: false,
      isSsoConnected: false,
    });
    expect(st.unconfigured).toBe(true);
    expect(st.settled).toBe('untested');
  });

  it('does not apply the SSO override to non-MindsHub providers', () => {
    const st = deriveProviderStatus('anthropic', {
      providerStatus: { anthropic: 'fail' },
      providerStatusDetails: {},
      configured: true,
      isSsoConnected: true,
    });
    expect(st.settled).toBe('fail');
  });

  it('tolerates missing option maps', () => {
    // No reasons map held reads as "not classified" (undefined), not "no refusal" (null).
    expect(deriveProviderStatus('openai', {})).toMatchObject({
      raw: 'untested', settled: 'untested', failed: false, unconfigured: true, detail: '', reason: undefined,
    });
    expect(deriveProviderStatus('openai')).toBeTruthy();
  });

  it("exposes the probe's refusal reason for its own type only", () => {
    const reason = { code: 'free_air_daily_spend_fuse_exceeded', resetAt: '2099-01-02T00:00:00Z' };
    const maps = {
      providerStatus: { 'minds-cloud': 'fail', anthropic: 'fail' },
      providerStatusDetails: { 'minds-cloud': 'HTTP 429', anthropic: 'HTTP 429' },
      providerStatusReasons: { 'minds-cloud': reason },
      configured: true,
    };
    expect(deriveProviderStatus('minds-cloud', maps).reason).toEqual(reason);
    // anthropic has no entry: nothing classified its probe.
    expect(deriveProviderStatus('anthropic', maps).reason).toBeUndefined();
  });

  it('tells a type the sidecar classified with no refusal (null) from one it never classified (undefined)', () => {
    const maps = {
      providerStatus: { 'minds-cloud': 'fail', anthropic: 'fail' },
      providerStatusDetails: { 'minds-cloud': 'HTTP 429', anthropic: 'HTTP 429' },
      providerStatusReasons: { 'minds-cloud': null },
      configured: true,
    };
    expect(deriveProviderStatus('minds-cloud', maps).reason).toBeNull();
    expect(deriveProviderStatus('anthropic', maps).reason).toBeUndefined();
  });

  it('never reads an inherited object key as a reasons entry', () => {
    expect(deriveProviderStatus('constructor', { providerStatusReasons: {} }).reason).toBeUndefined();
  });

  describe('stale failure verification (ENG-1113)', () => {
    const failing = (over) => deriveProviderStatus('minds-cloud', {
      providerStatus: { 'minds-cloud': 'fail' },
      providerStatusDetails: { 'minds-cloud': 'ReadTimeout' },
      configured: true,
      ...over,
    });

    it('trusts the recorded failure after the initial check settles', () => {
      expect(failing().checking).toBe(false);
    });

    it('holds the failure while the initial check is pending', () => {
      expect(failing({ initialTestDone: false }).checking).toBe(true);
    });

    it('holds the failure during a later Save or Test', () => {
      expect(failing({ testInProgress: true }).checking).toBe(true);
    });

    it('does not hold an unconfigured provider', () => {
      const st = deriveProviderStatus('openai', {
        providerStatus: { openai: 'fail' },
        configured: false,
        testInProgress: true,
        initialTestDone: false,
      });
      expect(st.checking).toBe(false);
    });

    it('does not hold a recorded success', () => {
      const st = deriveProviderStatus('anthropic', {
        providerStatus: { anthropic: 'ok' },
        configured: true,
        testInProgress: true,
        initialTestDone: false,
      });
      expect(st.checking).toBe(false);
    });
  });
});

describe('mindsProbeNotice', () => {
  const RESET = '2099-01-02T00:00:00Z';

  it.each([
    ['wallet_empty', 'no_credits', null],
    ['included_allowance_exhausted', 'allowance_used', RESET],
    ['free_air_daily_spend_fuse_exceeded', 'paused', RESET],
    ['rate_limited', 'slow_down', null],
    ['policy_unavailable', 'billing_unavailable', null],
  ])('maps the %s reason to the %s notice', (code, kind, resetAt) => {
    expect(mindsProbeNotice({ reason: { code, resetAt }, detail: 'HTTP 429: whatever' })).toEqual({ kind, resetAt });
  });

  it('follows the reason over the detail: a velocity 429 is not a credits problem', () => {
    // The legacy check alone reads any 429 as "No credits available".
    expect(mindsProbeNotice({ reason: { code: 'rate_limited', resetAt: null }, detail: 'HTTP 429' }))
      .toEqual({ kind: 'slow_down', resetAt: null });
  });

  it('gives no notice for a reason code it does not know', () => {
    expect(mindsProbeNotice({ reason: { code: 'something_new', resetAt: null }, detail: 'HTTP 429' })).toBeNull();
  });

  it('keeps the legacy detail check when the sidecar sends no reason', () => {
    /* An OTA renderer ahead of a sidecar that predates providerStatusReasons.
       Its types hold no entry, so the reason is undefined; null now means the
       sidecar classified the probe and named no refusal (next test). */
    expect(mindsProbeNotice({ reason: undefined, detail: 'HTTP 429' })).toEqual({ kind: 'no_credits', resetAt: null });
    expect(mindsProbeNotice({ detail: 'HTTP 402: Payment Required' })).toEqual({ kind: 'no_credits', resetAt: null });
    expect(mindsProbeNotice({ detail: 'Insufficient CREDIT' })).toEqual({ kind: 'no_credits', resetAt: null });
    expect(mindsProbeNotice({ detail: 'quota exceeded' })).toEqual({ kind: 'no_credits', resetAt: null });
  });

  it('gives no notice when a sidecar that sends reasons classified the probe and named none', () => {
    /* An upstream vendor 429 relayed through the gateway carries no
       X-MindsHub-Reason, so the sidecar names none. Each of these read as no
       credits under the legacy check. */
    expect(mindsProbeNotice({ reason: null, detail: 'HTTP 429: rate_limit_error from upstream' })).toBeNull();
    expect(mindsProbeNotice({ reason: null, detail: 'HTTP 402: Payment Required' })).toBeNull();
    expect(mindsProbeNotice({ reason: null, detail: 'Insufficient CREDIT' })).toBeNull();
    expect(mindsProbeNotice({ reason: null, detail: 'quota exceeded' })).toBeNull();
  });

  it('gives no notice for an unrelated failure with no reason', () => {
    expect(mindsProbeNotice({ reason: null, detail: 'HTTP 500' })).toBeNull();
    expect(mindsProbeNotice({ detail: '' })).toBeNull();
    expect(mindsProbeNotice()).toBeNull();
  });
});

describe('friendlyProviderError', () => {
  it('returns empty string for no detail', () => {
    expect(friendlyProviderError('')).toBe('');
    expect(friendlyProviderError(undefined)).toBe('');
  });

  it('maps the missing-credential sentinels', () => {
    expect(friendlyProviderError('missing API key')).toMatch(/Add an API key/);
    expect(friendlyProviderError('missing base URL')).toMatch(/Add a base URL/);
  });

  it('maps HTTP status codes', () => {
    expect(friendlyProviderError('HTTP 401')).toMatch(/Unauthorized/);
    expect(friendlyProviderError('HTTP 403')).toMatch(/Forbidden/);
    expect(friendlyProviderError('HTTP 404')).toMatch(/Endpoint not found/);
    expect(friendlyProviderError('HTTP 429')).toMatch(/Rate limited/);
    expect(friendlyProviderError('HTTP 503')).toMatch(/unreachable \(HTTP 503\)/);
    expect(friendlyProviderError('HTTP 418')).toMatch(/rejected the request \(HTTP 418\)/);
  });

  it('maps transport errors', () => {
    expect(friendlyProviderError('ConnectTimeout: ...')).toMatch(/Could not reach/);
    expect(friendlyProviderError('ReadTimeout: ...')).toMatch(/did not respond in time/);
    expect(friendlyProviderError('SSLError: bad certificate')).toMatch(/TLS \/ certificate/);
  });

  it('falls back to the raw detail when unmatched', () => {
    expect(friendlyProviderError('some novel error')).toBe('some novel error');
  });

  describe('with a probe refusal reason', () => {
    it.each([
      ['free_air_daily_spend_fuse_exceeded', 'Free MindsHub Air is paused right now.'],
      ['included_allowance_exhausted', 'No free allowance left, and the balance is empty.'],
      ['rate_limited', 'Too many requests too quickly. Wait a moment, then test again.'],
      ['policy_unavailable', 'Billing is temporarily unavailable. Try again in a moment.'],
      ['wallet_empty', 'No credits available. Add funds to use MindsHub.'],
    ])('names the %s stop instead of the bare status code', (code, copy) => {
      const status = code === 'wallet_empty' ? 'HTTP 402' : code === 'policy_unavailable' ? 'HTTP 503' : 'HTTP 429';
      expect(friendlyProviderError(status, { code, resetAt: null })).toBe(copy);
    });

    it('stops calling an allowance or fuse 429 "Rate limited"', () => {
      expect(friendlyProviderError('HTTP 429', { code: 'included_allowance_exhausted', resetAt: null })).not.toMatch(/Rate limited/);
      expect(friendlyProviderError('HTTP 429', { code: 'free_air_daily_spend_fuse_exceeded', resetAt: null })).not.toMatch(/Rate limited/);
    });

    it('falls back to the detail for an unknown reason code', () => {
      expect(friendlyProviderError('HTTP 429', { code: 'something_new', resetAt: null })).toMatch(/Rate limited/);
    });

    it('uses no em-dash in any reason copy', () => {
      for (const code of ['wallet_empty', 'included_allowance_exhausted', 'free_air_daily_spend_fuse_exceeded', 'rate_limited', 'policy_unavailable']) {
        expect(friendlyProviderError('HTTP 429', { code, resetAt: null })).not.toContain('\u2014');
      }
    });
  });
});
