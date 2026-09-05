import { describe, it, expect, vi, afterEach } from 'vitest';
import * as http from 'http';
// Use a distinct name for the real TCP socket module; Electron net below is mocked.
import * as nodeNet from 'net';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  net: { fetch: vi.fn() },
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

  // Bound the token exchange even after the browser says authorization succeeded; a dead connection
  // must not hang sign-in.
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
// A millisecond timeout proves the per-flow override replaced the three-minute default.
    const result = await oauthConnect({ ...OPTS, callbackTimeoutMs: 120 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out/i);
  });

  // Ignore mismatched-state requests without ending the legitimate authorization attempt.
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
    // Test equal-length mismatched bytes too: timingSafeEqual throws on length mismatch, which
    // exercises a different path.
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

  // Fixed-port reconnects must not reuse a prior attempt's keep-alive socket.
  // server.close stops new connections but leaves existing ones able to route callbacks to the old
  // state handler.
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

      // Wait for delayed teardown; the real flow closes its server after resolution, leaving a
      // brief reuse window.
      await new Promise((r) => setTimeout(r, 400));

      net.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'at-2' }) })) as unknown as typeof net.fetch;
      const flowB = oauthConnect({ ...OPTS, redirectPort: 47297 });
      const authUrlB = await nextAuthUrl();
      const stateB = authUrlB.searchParams.get('state') as string;

      // Reuse the same Agent so a leaked pooled socket would reach the prior state handler.
      const responseB = await hitCallback(authUrlB, { code: 'code-b', state: stateB }, { agent });
      expect(responseB.status).toBe(200);
      const resultB = await flowB;
      expect(resultB).toMatchObject({ ok: true, access_token: 'at-2' });
    } finally {
      agent.destroy();
    }
  });

  // Force-close speculative idle sockets too; per-response cleanup cannot catch connections that
  // never sent a request.
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

  // A retry must retire the previous loopback attempt so the user cannot complete two competing
  // authorizations.
  it('cancels a dangling previous attempt when a new one starts', async () => {
    const nextAuthUrl = captureAuthUrl();
    const first = oauthConnect(OPTS);
    await nextAuthUrl();

    const second = oauthConnect(OPTS);
    const firstResult = await first;
    expect(firstResult.ok).toBe(false);
    expect(firstResult.reason).toMatch(/cancelled/i);

    const secondUrl = await nextAuthUrl();
    cancelCurrentOAuth();
    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    expect(secondUrl.searchParams.get('state')).toBeTruthy();
  });

  // Cancel while openExternal is pending; rejecting before Promise.race subscribes must not cause
  // an unhandled-rejection crash.
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
