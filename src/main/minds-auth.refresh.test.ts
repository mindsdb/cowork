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
}));

import { saveTokens, getRefreshToken, clearTokens, getTokenStoreVersion } from './token-store';
import { refreshTokensOnly, cancelScheduledRefresh } from './minds-auth';

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
    (saveTokens as Mock).mockClear();
    (clearTokens as Mock).mockClear();
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

  it('saves tokens and schedules the next refresh on success', async () => {
    mockFetchOnce(async () => jsonResponse(200, { access_token: 'at-new', expires_in: 300, refresh_token: 'rt-2' }));
    const result = await refreshTokensOnly();
    expect(result).toEqual({ status: 'ok', token: 'at-new' });
    expect(saveTokens).toHaveBeenCalledWith('at-new', 300, 'rt-2');
    expect(clearTokens).not.toHaveBeenCalled();
    // Next refresh armed at expiry - 60s.
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
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

    // Retry fires at 60s and succeeds — the session recovers without an
    // app restart (the pre-fix timer never retried after a failure).
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(saveTokens).toHaveBeenCalledWith('at-after-retry', 300, 'rt-2');
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
