import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// minds-auth transitively imports server-process, which statically imports
// `electron`. In the node test env `electron` resolves to a path string, so
// stub it before importing the module under test.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

// Isolate the refresh logic from disk/keychain: the token store is the
// unit boundary here — we assert WHICH store transitions the refresh
// outcome drives (save on ok, clear on invalid_grant, neither on
// transient), not how the store persists them.
vi.mock('./token-store', () => ({
  saveTokens: vi.fn(),
  getRefreshToken: vi.fn(),
  clearTokens: vi.fn(),
  getTokenStoreVersion: vi.fn(),
  // A successful refresh hands the new token to the sidecar, which reads it
  // back from here. Omitting it makes that call reject unhandled rather than
  // fail a test, which reads as four mystery errors on an otherwise green run.
  getAccessToken: vi.fn(),
  isAccessTokenExpired: vi.fn(() => false),
}));
vi.mock('./minds-credential', () => ({
  hasUserSuppliedMindsCredential: vi.fn(async () => false),
  syncMindsCredential: vi.fn(async () => true),
  syncMindsCredentialSelection: vi.fn(async () => ({ landed: true, usable: true })),
  syncUsableMindsCredential: vi.fn(async () => true),
}));

import { saveTokens, getAccessToken, getRefreshToken, clearTokens, getTokenStoreVersion, isAccessTokenExpired } from './token-store';
import { hasUserSuppliedMindsCredential, syncMindsCredential, syncMindsCredentialSelection, syncUsableMindsCredential } from './minds-credential';
import { freshAccessToken, refreshTokensOnly, refreshMindsCredentialAfterResume, cancelScheduledRefresh } from './minds-auth';
import { isMindsResumeCredentialGateActive, settleMindsResumeCredentialGate, waitForMindsResumeCredential } from './minds-resume-gate';

const mockFetchOnce = (impl: () => Promise<unknown>) => {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// ─── ENG-761 regression: refresh outcomes must be distinguished ──────
//
// The pre-fix code collapsed every failure to `null`, and the boot path
// treated any falsy result as "refresh token expired" — clearing tokens
// and stripping env credentials. One network blip at launch permanently
// signed the user out. These tests pin the outcome taxonomy.
describe('refreshTokensOnly outcome mapping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (getRefreshToken as Mock).mockReturnValue('rt-1');
    (getTokenStoreVersion as Mock).mockReturnValue(0);
    (getAccessToken as Mock).mockReturnValue(null);
    (isAccessTokenExpired as Mock).mockReturnValue(false);
    (hasUserSuppliedMindsCredential as Mock).mockReset().mockResolvedValue(false);
    (saveTokens as Mock).mockClear();
    (clearTokens as Mock).mockClear();
    (syncMindsCredential as Mock).mockReset().mockResolvedValue(true);
    (syncMindsCredentialSelection as Mock).mockReset().mockResolvedValue({ landed: true, usable: true });
    (syncUsableMindsCredential as Mock).mockReset().mockResolvedValue(true);
    settleMindsResumeCredentialGate(true);
  });

  afterEach(() => {
    cancelScheduledRefresh();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('returns no_refresh_token without touching the network when none is stored', async () => {
    (getRefreshToken as Mock).mockReturnValue(null);
    // fetch stays in its denied state — reaching it would throw and be
    // misreported as `transient`, which this assertion would catch.
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'no_refresh_token' });
    expect(saveTokens).not.toHaveBeenCalled();
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('does not report success until the fresh credential has reached the sidecar', async () => {
    let releaseHandoff!: (landed: boolean) => void;
    (syncMindsCredential as Mock).mockReturnValueOnce(new Promise<boolean>((resolve) => {
      releaseHandoff = resolve;
    }));
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-new', expires_in: 300, refresh_token: 'rt-2' }));

    let settled = false;
    const pending = refreshTokensOnly().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(saveTokens).toHaveBeenCalledWith('at-new', 300, 'rt-2');
    expect(syncMindsCredential).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releaseHandoff(true);
    const result = await pending;
    expect(result).toEqual({ status: 'ok', token: 'at-new' });
    expect(clearTokens).not.toHaveBeenCalled();
    // Next refresh armed at expiry - 60s.
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('retries a failed sidecar PUT without rotating the Keycloak token again', async () => {
    const fetch = mockFetchOnce(async () => jsonResponse(200, {
      access_token: 'at-new',
      expires_in: 300,
      refresh_token: 'rt-2',
    }));
    (syncMindsCredential as Mock)
      .mockResolvedValueOnce(false);

    await expect(refreshTokensOnly()).resolves.toEqual({ status: 'handoff_pending', token: 'at-new' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(syncMindsCredential).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(syncMindsCredential).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(syncMindsCredential).toHaveBeenCalledTimes(1);
    expect(syncMindsCredentialSelection).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a refreshed token available before the sidecar is installed', async () => {
    (getAccessToken as Mock).mockReturnValue('expired-token');
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    (syncMindsCredential as Mock).mockResolvedValueOnce(false);
    mockFetchOnce(async () => jsonResponse(200, {
      access_token: 'fresh-preinstall-token',
      expires_in: 300,
    }));

    await expect(freshAccessToken()).resolves.toBe('fresh-preinstall-token');
  });

  it('keeps the rotated-out refresh token when Keycloak returns none', async () => {
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-new', expires_in: 300 }));
    await refreshTokensOnly();
    expect(saveTokens).toHaveBeenCalledWith('at-new', 300, 'rt-1');
  });

  it('clears the session ONLY on an explicit invalid_grant', async () => {
    mockFetchOnce(async () => jsonResponse(400, { error: 'invalid_grant', error_description: 'Session not active' }));
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'invalid_grant' });
    expect(clearTokens).toHaveBeenCalledTimes(1);
    expect(saveTokens).not.toHaveBeenCalled();
    // Dead session — no retry timer left armed.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a 400 WITHOUT invalid_grant as transient (keeps tokens, retries)', async () => {
    mockFetchOnce(async () => jsonResponse(400, { error: 'invalid_client' }));
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'transient' });
    expect(clearTokens).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('treats a Keycloak 5xx as transient (keeps tokens, retries)', async () => {
    mockFetchOnce(async () => jsonResponse(503, {}));
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'transient' });
    expect(clearTokens).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('treats a network failure as transient (keeps tokens, retries)', async () => {
    mockFetchOnce(async () => { throw new Error('getaddrinfo ENOTFOUND auth.mindshub.ai'); });
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'transient' });
    expect(clearTokens).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('treats a 200 response without an access token as transient', async () => {
    mockFetchOnce(async () => jsonResponse(200, { expires_in: 300 }));
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'transient' });
    expect(saveTokens).not.toHaveBeenCalled();
    expect(clearTokens).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
  });

  it('ignores a success response superseded by logout or a newer login', async () => {
    let release!: (value: unknown) => void;
    const response = new Promise((resolve) => { release = resolve; });
    mockFetchOnce(async () => response);

    const pending = refreshTokensOnly();
    (getTokenStoreVersion as Mock).mockReturnValue(1);
    release(jsonResponse(200, { access_token: 'stale-at', refresh_token: 'stale-rt' }));

    await expect(pending).resolves.toEqual({ status: 'superseded' });
    expect(saveTokens).not.toHaveBeenCalled();
    expect(clearTokens).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not clear a newer session for a superseded invalid_grant', async () => {
    let release!: (value: unknown) => void;
    const response = new Promise((resolve) => { release = resolve; });
    mockFetchOnce(async () => response);

    const pending = refreshTokensOnly();
    (getTokenStoreVersion as Mock).mockReturnValue(1);
    release(jsonResponse(400, { error: 'invalid_grant' }));

    await expect(pending).resolves.toEqual({ status: 'superseded' });
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('converges to signed-in when the retry timer fires after connectivity returns', async () => {
    // First attempt: network down → transient, retry armed.
    const fn = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('network down'); })
      .mockImplementation(async () => jsonResponse(200, { access_token: 'at-after-retry', expires_in: 300, refresh_token: 'rt-2' }));
    globalThis.fetch = fn as unknown as typeof fetch;

    const first = await refreshTokensOnly();
    expect(first.status).toBe('transient');
    expect(saveTokens).not.toHaveBeenCalled();

    // Retry fires well before the 60-second expiry buffer is exhausted and
    // succeeds — the session recovers without an
    // app restart (the pre-fix timer never retried after a failure).
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(saveTokens).toHaveBeenCalledWith('at-after-retry', 300, 'rt-2');
  });

  it('holds an immediate post-resume turn until refresh and handoff finish', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    let releaseHandoff!: (landed: boolean) => void;
    (syncMindsCredential as Mock).mockReturnValueOnce(new Promise<boolean>((resolve) => {
      releaseHandoff = resolve;
    }));
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-after-wake', expires_in: 300 }));

    const refresh = refreshMindsCredentialAfterResume();
    expect(refresh).not.toBeNull();
    let turnReleased = false;
    const turnGate = waitForMindsResumeCredential().then((ready) => {
      turnReleased = true;
      return ready;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(syncMindsCredential).toHaveBeenCalledTimes(1);
    expect(turnReleased).toBe(false);

    releaseHandoff(true);
    await expect(refresh).resolves.toEqual({ status: 'ok', token: 'at-after-wake' });
    await expect(turnGate).resolves.toBe(true);
    expect(isMindsResumeCredentialGateActive()).toBe(false);
  });

  it('does not arm the resume gate while the access token is still fresh', () => {
    expect(refreshMindsCredentialAfterResume()).toBeNull();
    expect(isMindsResumeCredentialGateActive()).toBe(false);
    expect(hasUserSuppliedMindsCredential).not.toHaveBeenCalled();
  });

  it('releases a resumed turn after the handoff-only retry succeeds', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    (syncMindsCredential as Mock).mockResolvedValueOnce(false);
    (syncMindsCredentialSelection as Mock).mockResolvedValueOnce({ landed: true, usable: true });
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-after-wake', expires_in: 300 }));

    await expect(refreshMindsCredentialAfterResume()).resolves.toEqual({
      status: 'handoff_pending',
      token: 'at-after-wake',
    });
    const turnGate = waitForMindsResumeCredential();
    expect(isMindsResumeCredentialGateActive()).toBe(true);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(syncMindsCredentialSelection).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(syncMindsCredentialSelection).toHaveBeenCalledTimes(1);
    expect(isMindsResumeCredentialGateActive()).toBe(false);
    await expect(turnGate).resolves.toBe(true);
  });

  it('schedules the next refresh from token issuance, not delayed handoff completion', async () => {
    let releaseHandoff!: (landed: boolean) => void;
    (syncMindsCredential as Mock).mockReturnValueOnce(new Promise<boolean>((resolve) => {
      releaseHandoff = resolve;
    }));
    const fetch = mockFetchOnce(async () => jsonResponse(200, {
      access_token: 'at-new',
      expires_in: 300,
    }));

    const refresh = refreshTokensOnly();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    releaseHandoff(true);
    await expect(refresh).resolves.toEqual({ status: 'ok', token: 'at-new' });

    await vi.advanceTimersByTimeAsync(209_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not hold a user-supplied key behind an unrelated SSO refresh', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    (hasUserSuppliedMindsCredential as Mock).mockResolvedValueOnce(true);
    mockFetchOnce(async () => jsonResponse(503, { error: 'temporarily_unavailable' }));

    const refresh = refreshMindsCredentialAfterResume();
    expect(refresh).not.toBeNull();
    await expect(waitForMindsResumeCredential()).resolves.toBe(true);
    expect(isMindsResumeCredentialGateActive()).toBe(false);
    await expect(refresh).resolves.toEqual({ status: 'transient' });
  });

  it('does not let a cancelled BYOK lookup reopen the resume gate', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    let releaseKeyLookup!: (present: boolean) => void;
    (hasUserSuppliedMindsCredential as Mock).mockReturnValueOnce(
      new Promise<boolean>((resolve) => { releaseKeyLookup = resolve; }),
    );
    const fetch = mockFetchOnce(async () => jsonResponse(200, {
      access_token: 'must-not-refresh-after-logout',
      expires_in: 300,
    }));

    const refresh = refreshMindsCredentialAfterResume();
    cancelScheduledRefresh();
    settleMindsResumeCredentialGate(false);
    releaseKeyLookup(true);

    await expect(refresh).resolves.toEqual({ status: 'superseded' });
    expect(fetch).not.toHaveBeenCalled();
    expect(isMindsResumeCredentialGateActive()).toBe(true);
    await expect(waitForMindsResumeCredential()).resolves.toBe(false);
  });

  it('settles a resumed turn against the selected credential when a retry is superseded', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    let releaseRetry!: (response: unknown) => void;
    const retryResponse = new Promise<unknown>((resolve) => { releaseRetry = resolve; });
    const fetch = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('network down'); })
      .mockImplementationOnce(async () => retryResponse);
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    await expect(refreshMindsCredentialAfterResume()).resolves.toEqual({ status: 'transient' });
    const turnGate = waitForMindsResumeCredential();

    await vi.advanceTimersByTimeAsync(10_000);
    (getTokenStoreVersion as Mock).mockReturnValue(1);
    releaseRetry(jsonResponse(200, { access_token: 'superseded-token' }));

    await expect(turnGate).resolves.toBe(true);
    expect(syncUsableMindsCredential).toHaveBeenCalledTimes(1);
    expect(saveTokens).not.toHaveBeenCalled();
  });

  it('does not let a cancelled selected-credential repair reopen the gate', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    let tokenStoreVersion = 0;
    (getTokenStoreVersion as Mock).mockImplementation(() => tokenStoreVersion);
    let releaseFetch!: (response: unknown) => void;
    globalThis.fetch = vi.fn(() => new Promise<unknown>((resolve) => {
      releaseFetch = resolve;
    })) as unknown as typeof globalThis.fetch;
    let releaseRepair!: (ready: boolean) => void;
    (syncUsableMindsCredential as Mock).mockReturnValueOnce(
      new Promise<boolean>((resolve) => { releaseRepair = resolve; }),
    );

    const refresh = refreshMindsCredentialAfterResume();
    await Promise.resolve();
    await Promise.resolve();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    tokenStoreVersion = 1;
    releaseFetch(jsonResponse(200, {
      access_token: 'superseded-token',
      expires_in: 300,
    }));
    await expect(refresh).resolves.toEqual({ status: 'superseded' });
    expect(syncUsableMindsCredential).toHaveBeenCalledTimes(1);

    cancelScheduledRefresh();
    settleMindsResumeCredentialGate(false);
    releaseRepair(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(isMindsResumeCredentialGateActive()).toBe(true);
    await expect(waitForMindsResumeCredential()).resolves.toBe(false);
  });

  it('does not start supersession repair after logout also clears tokens', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    let tokenStoreVersion = 0;
    (getTokenStoreVersion as Mock).mockImplementation(() => tokenStoreVersion);
    let releaseFetch!: (response: unknown) => void;
    globalThis.fetch = vi.fn(() => new Promise<unknown>((resolve) => {
      releaseFetch = resolve;
    })) as unknown as typeof globalThis.fetch;
    (syncUsableMindsCredential as Mock).mockResolvedValueOnce(true);

    const refresh = refreshMindsCredentialAfterResume();
    await Promise.resolve();
    await Promise.resolve();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    cancelScheduledRefresh();
    settleMindsResumeCredentialGate(false);
    tokenStoreVersion = 1;
    releaseFetch(jsonResponse(200, {
      access_token: 'stale-after-logout',
      expires_in: 300,
    }));

    await expect(refresh).resolves.toEqual({ status: 'superseded' });
    expect(syncUsableMindsCredential).not.toHaveBeenCalled();
    expect(isMindsResumeCredentialGateActive()).toBe(true);
    await expect(waitForMindsResumeCredential()).resolves.toBe(false);
  });

  it('repairs the sidecar when logout overtakes a saved token handoff', async () => {
    let tokenStoreVersion = 0;
    (getTokenStoreVersion as Mock).mockImplementation(() => tokenStoreVersion);
    let releaseHandoff!: (landed: boolean) => void;
    (syncMindsCredential as Mock).mockReturnValueOnce(new Promise<boolean>((resolve) => {
      releaseHandoff = resolve;
    }));
    (syncUsableMindsCredential as Mock).mockResolvedValueOnce(false);
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-losing-race', expires_in: 300 }));

    (isAccessTokenExpired as Mock).mockReturnValue(true);
    const refresh = refreshMindsCredentialAfterResume();
    const turnGate = waitForMindsResumeCredential();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(saveTokens).toHaveBeenCalledWith('at-losing-race', 300, 'rt-1');

    tokenStoreVersion = 1;
    releaseHandoff(true);

    await expect(refresh).resolves.toEqual({ status: 'superseded' });
    await expect(turnGate).resolves.toBe(false);
    expect(syncUsableMindsCredential).toHaveBeenCalledTimes(1);
  });

  it('does not let a cancelled refresh handoff reopen the resume gate', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    let releaseHandoff!: (landed: boolean) => void;
    (syncMindsCredential as Mock).mockReturnValueOnce(new Promise<boolean>((resolve) => {
      releaseHandoff = resolve;
    }));
    mockFetchOnce(async () => jsonResponse(200, {
      access_token: 'at-before-logout',
      expires_in: 300,
    }));

    const refresh = refreshMindsCredentialAfterResume();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncMindsCredential).toHaveBeenCalledTimes(1);

    cancelScheduledRefresh();
    settleMindsResumeCredentialGate(false);
    releaseHandoff(true);

    await expect(refresh).resolves.toEqual({ status: 'superseded' });
    expect(isMindsResumeCredentialGateActive()).toBe(true);
    await expect(waitForMindsResumeCredential()).resolves.toBe(false);
  });

  it('does not let a cancelled handoff-only retry reopen the resume gate', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    (syncMindsCredential as Mock).mockResolvedValueOnce(false);
    let releaseRetry!: (result: { landed: boolean; usable: boolean }) => void;
    (syncMindsCredentialSelection as Mock).mockReturnValueOnce(
      new Promise<{ landed: boolean; usable: boolean }>((resolve) => {
        releaseRetry = resolve;
      }),
    );
    mockFetchOnce(async () => jsonResponse(200, {
      access_token: 'at-before-logout',
      expires_in: 300,
    }));

    await expect(refreshMindsCredentialAfterResume()).resolves.toEqual({
      status: 'handoff_pending',
      token: 'at-before-logout',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncMindsCredentialSelection).toHaveBeenCalledTimes(1);

    cancelScheduledRefresh();
    settleMindsResumeCredentialGate(false);
    releaseRetry({ landed: true, usable: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(isMindsResumeCredentialGateActive()).toBe(true);
    await expect(waitForMindsResumeCredential()).resolves.toBe(false);
  });

  it('does not confuse ordinary retry completion with refresh cancellation', async () => {
    let releaseSecondRefresh!: (response: unknown) => void;
    const secondResponse = new Promise<unknown>((resolve) => {
      releaseSecondRefresh = resolve;
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        access_token: 'at-first',
        expires_in: 300,
      }))
      .mockImplementationOnce(async () => secondResponse);
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    (syncMindsCredential as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(refreshTokensOnly()).resolves.toEqual({
      status: 'handoff_pending',
      token: 'at-first',
    });

    const secondRefresh = refreshTokensOnly();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncMindsCredentialSelection).toHaveBeenCalledTimes(1);

    releaseSecondRefresh(jsonResponse(200, {
      access_token: 'at-second',
      expires_in: 300,
    }));
    await expect(secondRefresh).resolves.toEqual({
      status: 'ok',
      token: 'at-second',
    });
  });

  it('does not release a resumed turn when invalid_grant leaves no usable credential', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    (syncUsableMindsCredential as Mock).mockResolvedValueOnce(false);
    mockFetchOnce(async () => jsonResponse(400, { error: 'invalid_grant' }));

    const refresh = refreshMindsCredentialAfterResume();
    const turnGate = waitForMindsResumeCredential();

    await expect(refresh).resolves.toEqual({ status: 'invalid_grant' });
    await expect(turnGate).resolves.toBe(false);
    expect(syncUsableMindsCredential).toHaveBeenCalledTimes(1);
  });

  it('settles false when a timer retry finds the refresh token was removed', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    mockFetchOnce(async () => { throw new Error('network down'); });

    await expect(refreshMindsCredentialAfterResume()).resolves.toEqual({ status: 'transient' });
    const turnGate = waitForMindsResumeCredential();
    (getRefreshToken as Mock).mockReturnValue(null);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(turnGate).resolves.toBe(false);
  });

  it('does not reopen a handoff retry after logout leaves no selected credential', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    (syncMindsCredential as Mock).mockResolvedValueOnce(false);
    (syncMindsCredentialSelection as Mock).mockResolvedValueOnce({ landed: true, usable: false });
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-before-logout', expires_in: 300 }));

    await expect(refreshMindsCredentialAfterResume()).resolves.toEqual({ status: 'handoff_pending', token: 'at-before-logout' });
    const turnGate = waitForMindsResumeCredential();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(turnGate).resolves.toBe(false);
    expect(syncMindsCredentialSelection).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncMindsCredentialSelection).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent callers onto one Keycloak round-trip', async () => {
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => { release = r; });
    const fn = vi.fn(async () => { await gate; return jsonResponse(200, { access_token: 'at', expires_in: 300 }); });
    globalThis.fetch = fn as unknown as typeof fetch;

    const p1 = refreshTokensOnly();
    const p2 = refreshTokensOnly();
    release(null);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ status: 'ok', token: 'at' });
    expect(r2).toEqual(r1);
  });
});
