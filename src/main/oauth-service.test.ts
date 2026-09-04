import { describe, it, expect, vi, afterEach } from 'vitest';
import * as http from 'http';
// Renamed to avoid colliding with the `net` import from 'electron' below —
// this one is the real loopback TCP socket used for the idle-connection
// test; that one is the mocked Electron net.fetch used everywhere else.
import * as nodeNet from 'net';

// `app` is here for cowork-home, which oauth-service now reaches through to
// resolve the channel's scheme; unpackaged → dev, same stub as minds-urls.test.
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  net: { fetch: vi.fn() },
  app: { isPackaged: false },
}));

import { shell, net } from 'electron';
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

function hitCallback(
  authUrl: URL, params: Record<string, string>, opts: http.RequestOptions = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const redirect = new URL(authUrl.searchParams.get('redirect_uri') as string);
  const qs = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${redirect.port}/callback?${qs}`, opts, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
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
    net.fetch = fetchMock as unknown as typeof net.fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const page = await hitCallback(authUrl, { code: 'the-code', state: authUrl.searchParams.get('state') as string });
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/authorized/i);

    const result = await flow;
    expect(result).toMatchObject({ ok: true, access_token: 'at', refresh_token: 'rt', expires_in: 300, token_type: 'Bearer' });
    const [, exchangeInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const exchangeBody = String(exchangeInit.body);
    expect(exchangeBody).toContain('grant_type=authorization_code');
    expect(exchangeBody).toContain('code=the-code');
  });

  // Windows refuses a foreground request from a process that isn't frontmost,
  // so the page has to offer the scheme route back. macOS regains focus on its
  // own and must not be handed a link that only triggers a browser prompt.
  it('offers the return link on Windows and withholds it on macOS', async () => {
    const originalPlatform = process.platform;
    const setPlatform = (value: string) =>
      Object.defineProperty(process, 'platform', { value, configurable: true });

    const succeed = async () => {
      const nextAuthUrl = captureAuthUrl();
      net.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 300, token_type: 'Bearer' }),
      })) as unknown as typeof net.fetch;
      const flow = oauthConnect(OPTS);
      const authUrl = await nextAuthUrl();
      const page = await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });
      await flow;
      return page.body;
    };

    try {
      setPlatform('win32');
      const onWindows = await succeed();
      expect(onWindows).toContain('://auth-done');
      expect(onWindows).toMatch(/Return to MindsHub Cowork/);

      setPlatform('darwin');
      const onMac = await succeed();
      expect(onMac).not.toContain('://auth-done');
      expect(onMac).toMatch(/authorized/i);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  // ─── GitHub regression: classic OAuth apps return form-urlencoded ───
  // bodies from /login/oauth/access_token unless the request asks for
  // JSON. Without this header the exchange threw "Unexpected token 'a',
  // \"access_tok\"... is not valid JSON" and the caller never saw
  // pkceResult.ok, so the window-refocus step never ran either.
  it('uses a provider-specific localhost redirect host', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) })) as unknown as typeof net.fetch;

    const flow = oauthConnect({ ...OPTS, redirectPort: 47292, redirectHost: 'localhost' });
    const authUrl = await nextAuthUrl();
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:47292/callback');
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });
    await flow;
  });

  it('uses 127.0.0.1 by default', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) })) as unknown as typeof net.fetch;

    const flow = oauthConnect({ ...OPTS, redirectPort: 47293 });
    const authUrl = await nextAuthUrl();
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:47293/callback');
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });
    await flow;
  });

  it('requests a JSON response from the token endpoint', async () => {
    const nextAuthUrl = captureAuthUrl();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at' }),
    }));
    net.fetch = fetchMock as unknown as typeof net.fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });
    await flow;

    const [, exchangeInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((exchangeInit.headers as Record<string, string>).Accept).toBe('application/json');
  });

  // ─── ENG-761 regression: a dead exchange must FAIL, visibly ─────────
  // The browser has already shown "You're authorized!" by the time the
  // exchange runs. Pre-fix, the exchange had no timeout — a black-holed
  // connection hung the sign-in forever with zero feedback.
  it('maps an exchange timeout to an actionable reason', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof net.fetch;

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
    net.fetch = fetchMock as unknown as typeof net.fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });
    await flow;

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a successful exchange response without an access token', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ expires_in: 300 }) })) as unknown as typeof net.fetch;

    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    await hitCallback(authUrl, { code: 'c', state: authUrl.searchParams.get('state') as string });

    const result = await flow;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/access token/i);
  });

  it('honors a caller-supplied callback timeout (ENG-917 signup window)', async () => {
    captureAuthUrl(); // swallow the browser open; never fire the callback
    // The default window is 3 minutes — this resolving in milliseconds
    // proves the per-flow override reached the timeout race.
    const result = await oauthConnect({ ...OPTS, callbackTimeoutMs: 120 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/i);
  });

  // A mismatched-state hit no longer tears the whole attempt down (see the
  // fixed-port stray-callback fix below) — it's answered on its own and the
  // server keeps listening, so it can't be used to abort someone else's
  // legitimate, still-in-flight authorization.
  it('answers a callback whose state does not match without failing the flow', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) })) as unknown as typeof net.fetch;
    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    const realState = authUrl.searchParams.get('state') as string;

    const page = await hitCallback(authUrl, { code: 'c', state: 'forged-state' });
    expect(page.status).toBe(400);

    // The real callback, arriving after the forged one, still completes it.
    await hitCallback(authUrl, { code: 'the-real-code', state: realState });
    const result = await flow;
    expect(result.ok).toBe(true);
  });

  it('answers a same-length forged state without failing the flow (exercises the byte compare, not just the length check)', async () => {
    // The state comparison uses crypto.timingSafeEqual, which throws on a
    // length mismatch rather than comparing — this pins that the real
    // path (mismatched bytes at equal length, the actual state param's
    // length) is also tolerated, not just the differently-sized
    // 'forged-state' case above.
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) })) as unknown as typeof net.fetch;
    const flow = oauthConnect(OPTS);
    const authUrl = await nextAuthUrl();
    const realState = authUrl.searchParams.get('state') as string;
    // Same length, one character changed — guaranteed different from realState.
    const forgedSameLength = realState.slice(0, -1) + (realState.at(-1) === 'a' ? 'b' : 'a');

    const page = await hitCallback(authUrl, { code: 'c', state: forgedSameLength });
    expect(page.status).toBe(400);

    await hitCallback(authUrl, { code: 'the-real-code', state: realState });
    const result = await flow;
    expect(result.ok).toBe(true);
  });

  // ─── Supabase org2 regression: a stray hit at a reused fixed port must
  // not abort a legitimate, still-in-flight authorization ───
  it('tolerates a stray no-code hit at a reused fixed port and still completes on the real callback', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt' }) })) as unknown as typeof net.fetch;
    const flow = oauthConnect({ ...OPTS, redirectPort: 47298, redirectHost: 'localhost' });
    const authUrl = await nextAuthUrl();
    const realState = authUrl.searchParams.get('state') as string;

    // e.g. a leftover browser tab from a prior connect replaying its old,
    // now-stale redirect at the same fixed port — no code, no valid state.
    const stray = await hitCallback(authUrl, { state: 'stale-from-a-previous-attempt' });
    expect(stray.status).toBe(400);

    await hitCallback(authUrl, { code: 'the-real-code', state: realState });
    const result = await flow;
    expect(result).toMatchObject({ ok: true, access_token: 'at', refresh_token: 'rt' });
  });

  // ─── Supabase multi-org regression: a fixed-port reconnect must not ───
  // land on a stale keep-alive connection from a PRIOR attempt.
  //
  // Browsers pool/reuse HTTP/1.1 keep-alive connections per host:port.
  // For a fixed-port provider (redirectPort set), reconnecting the same
  // connector reuses the same port — and `server.close()` (called after a
  // successful attempt) only stops *new* connections; it deliberately
  // leaves an already-open connection alive. A later attempt's real
  // redirect could land on that stale connection, hitting the FIRST
  // attempt's handler (and its `state`) instead of the new one's — a
  // confusing "state mismatch" on an otherwise perfectly correct callback.
  // Confirmed live: the *received* state matched the new attempt's own
  // authorize request exactly, but was checked against the previous
  // attempt's `state`.
  it('does not let a keep-alive connection from a completed attempt serve the next attempt on the same fixed port', async () => {
    const agent = new http.Agent({ keepAlive: true });
    try {
      const nextAuthUrl = captureAuthUrl();
      net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at-1' }) })) as unknown as typeof net.fetch;
      const flowA = oauthConnect({ ...OPTS, redirectPort: 47297 });
      const authUrlA = await nextAuthUrl();
      const stateA = authUrlA.searchParams.get('state') as string;

      const responseA = await hitCallback(authUrlA, { code: 'code-a', state: stateA }, { agent });
      expect(responseA.headers.connection).toBe('close');
      const resultA = await flowA;
      expect(resultA.ok).toBe(true);

      // Real teardown timing: oauthConnect closes the server ~300ms after
      // resolving, not synchronously — this is the exact window in which a
      // pooled keep-alive connection could otherwise get reused.
      await new Promise((r) => setTimeout(r, 400));

      net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at-2' }) })) as unknown as typeof net.fetch;
      const flowB = oauthConnect({ ...OPTS, redirectPort: 47297 });
      const authUrlB = await nextAuthUrl();
      const stateB = authUrlB.searchParams.get('state') as string;

      // Same Agent instance as request A — if the connection were reused,
      // this would be routed to attempt A's already-superseded handler
      // (still checking against stateA) instead of attempt B's server.
      const responseB = await hitCallback(authUrlB, { code: 'code-b', state: stateB }, { agent });
      expect(responseB.status).toBe(200);
      const resultB = await flowB;
      expect(resultB).toMatchObject({ ok: true, access_token: 'at-2' });
    } finally {
      agent.destroy();
    }
  });

  // ─── Supabase multi-org regression, part 2: an idle connection that ───
  // never sent a request must not survive teardown either.
  //
  // `Connection: close` + destroying the socket after a response only
  // cleans up connections that actually completed a request/response cycle.
  // A browser can also open a connection to an origin speculatively (e.g. a
  // preconnect) and hold it open without ever sending a request over it —
  // that socket is still tracked as "open" by the server and wouldn't be
  // touched by a per-response cleanup at all. If the browser later reuses
  // that idle socket for the NEXT attempt's real callback, it would still
  // land on the superseded server. `closeServer()` must force-close every
  // connection it's tracking on teardown, not just ones that responded.
  it('destroys an idle connection that never sent a request when the server tears down', async () => {
    const nextAuthUrl = captureAuthUrl();
    net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at' }) })) as unknown as typeof net.fetch;
    const flow = oauthConnect({ ...OPTS, redirectPort: 47296 });
    const authUrl = await nextAuthUrl();
    const state = authUrl.searchParams.get('state') as string;
    const port = Number(new URL(authUrl.searchParams.get('redirect_uri') as string).port);

    // A connection that never sends a request — simulates a browser's
    // idle/speculative keep-alive socket to this origin.
    const idleSocket = nodeNet.connect(port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      idleSocket.once('connect', () => resolve());
      idleSocket.once('error', reject);
    });

    await hitCallback(authUrl, { code: 'the-code', state });
    await flow;

    // Real teardown timing (300ms after resolving).
    const closed = new Promise<void>((resolve) => idleSocket.once('close', () => resolve()));
    await Promise.race([closed, new Promise((r) => setTimeout(r, 1000))]);
    expect(idleSocket.destroyed || idleSocket.closed).toBe(true);
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
    net.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    )) as unknown as typeof net.fetch;

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
