import { describe, it, expect } from 'vitest';
import { deriveProviderStatus, friendlyProviderError } from './providerStatus';

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
    expect(deriveProviderStatus('openai', {})).toMatchObject({
      raw: 'untested', settled: 'untested', failed: false, unconfigured: true, detail: '',
    });
    expect(deriveProviderStatus('openai')).toBeTruthy();
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
});
