import { describe, it, expect, vi, afterEach } from 'vitest';
import * as http from 'http';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

import { shell } from 'electron';
import { oauthConnect, cancelCurrentOAuth } from './oauth-service';

const OPTS = {
  authUrl: 'https://kc.example/realms/x/auth',
  tokenUrl: 'https://kc.example/realms/x/token',
  clientId: 'test-client',
  scopes: ['openid'],
};

// Captures the authorize URL oauthConnect hands the browser, so the test
// can play the browser's part against the real loopback server.
function captureAuthUrl(): () => Promise<URL> {
  const opened: string[] = [];
  (shell.openExternal as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
    opened.push(url);
  });
  return async () => {
    for (let i = 0; i < 200 && opened.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (!opened.length) throw new Error('authorize URL was never opened');
    return new URL(opened.shift() as string);
  };
}

function hitCallback(authUrl: URL, params: Record<string, string>): Promise<{ status: number; body: string }> {
  const redirect = new URL(authUrl.searchParams.get('redirect_uri') as string);
  const qs = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${redirect.port}/callback?${qs}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    }).on('error', reject);
  });
}

afterEach(() => {
  // Tear down any loopback server a test left behind.
  cancelCurrentOAuth();
});

describe('oauthConnect', () => {
  it('serves the success page and exchanges the code for tokens', async () => {
    const nextAuthUrl = captureAuthUrl();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 300, token_type: 'Bearer' }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const page = await hitCallback(authUrl, { code: 'the-code', state: authUrl.searchParams.get('state') as string });
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/authorized/i);

    const result = await flow;
    expect(result).toMatchObject({ ok: true, access_token: 'at', refresh_token: 'rt', expires_in: 300 });
    const [, exchangeInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const exchangeBody = String(exchangeInit.body);
    expect(exchangeBody).toContain('grant_type=authorization_code');
    expect(exchangeBody).toContain('code=the-code');
  });

  // ─── ENG-761 regression: a dead exchange must FAIL, visibly ─────────
  // The browser has already shown "You're authorized!" by the time the
  // exchange runs. Pre-fix, the exchange had no timeout — a black-holed
  // connection hung the sign-in forever with zero feedback.
  it('maps an exchange timeout to an actionable reason', async () => {
    const nextAuthUrl = captureAuthUrl();
    globalThis.fetch = vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });

    const result = await flow;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/i);
  });

  it('passes an abort deadline to the exchange request', async () => {
    const nextAuthUrl = captureAuthUrl();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });
    await flow;

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a successful exchange response without an access token', async () => {
    const nextAuthUrl = captureAuthUrl();
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ expires_in: 300 }) })) as unknown as typeof fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });

    const result = await flow;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/access token/i);
  });

  it('rejects a callback whose state does not match', async () => {
    const nextAuthUrl = captureAuthUrl();
    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();

    const page = await hitCallback(authUrl, { code: 'c', state: 'forged-state' });
    expect(page.status).toBe(400);

    const result = await flow;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/state mismatch/i);
  });

  // ─── ENG-761: no two live loopback attempts ─────────────────────────
  // A retry (double-click, second sign-in surface) used to leave the
  // previous attempt's server listening; whichever tab the user finished
  // decided which promise won.
  it('cancels a dangling previous attempt when a new one starts', async () => {
    const nextAuthUrl = captureAuthUrl();
    const first = oauthConnect(OPTS);
    await nextAuthUrl();

    const second = oauthConnect(OPTS);
    const firstResult = await first;
    expect(firstResult.ok).toBe(false);
    expect(firstResult.reason).toMatch(/cancelled/i);

    // Clean up the second attempt.
    const secondUrl = await nextAuthUrl();
    cancelCurrentOAuth();
    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    expect(secondUrl.searchParams.get('state')).toBeTruthy();
  });

  // ENG-761 regression: a cancel landing while oauthConnect is still
  // awaiting shell.openExternal used to reject codePromise before
  // Promise.race subscribed — an unhandled rejection, which crashes the
  // Electron main process into the error dialog. (Vitest fails the run
  // on unhandled rejections, so this test guards the crash itself.)
  it('resolves cleanly when cancelled during the browser-open gap', async () => {
    let releaseOpen!: () => void;
    const openExternal = shell.openExternal as ReturnType<typeof vi.fn>;
    openExternal.mockReset();
    openExternal.mockImplementation(() => new Promise<void>((r) => { releaseOpen = r; }));

    const flow = oauthConnect(OPTS);
    for (let i = 0; i < 200 && openExternal.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    cancelCurrentOAuth();
    releaseOpen();

    const result = await flow;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it('cancels a previous attempt while its token exchange is pending', async () => {
    const nextAuthUrl = captureAuthUrl();
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    )) as unknown as typeof fetch;

    const first = oauthConnect(OPTS);
    const firstUrl = await nextAuthUrl();
    await hitCallback(firstUrl, { code: 'c', state: firstUrl.searchParams.get('state') as string });

    const second = oauthConnect(OPTS);
    await expect(first).resolves.toMatchObject({ ok: false, reason: 'cancelled' });

    await nextAuthUrl();
    cancelCurrentOAuth();
    await expect(second).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
  });
});
