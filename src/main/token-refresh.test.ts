import { describe, it, expect, vi, afterEach } from 'vitest';

// token-refresh.ts pulls in keychain-service.ts, which imports the native
// `keytar` module at load time — fine on macOS (Keychain Services), but it
// requires libsecret on Linux, which CI's runner doesn't have. This test
// only exercises the pure parseAppIdFromClientId function, so the real
// keychain module is never needed; mocking it here avoids paying that
// native-dependency cost just to import the file at all.
vi.mock('./keychain-service', () => ({
  getRefreshToken: vi.fn(),
  setRefreshToken: vi.fn(),
}));

import { getRefreshToken, setRefreshToken } from './keychain-service';
import { parseAppIdFromClientId, startRefreshLoop, stopAllRefreshLoops } from './token-refresh';

describe('parseAppIdFromClientId', () => {
  it('extracts the leading project number from a standard client id', () => {
    expect(parseAppIdFromClientId('123456789012-abc123def456.apps.googleusercontent.com')).toBe(
      '123456789012',
    );
  });

  it('returns empty string for a client id with no leading digits', () => {
    expect(parseAppIdFromClientId('abc123def456.apps.googleusercontent.com')).toBe('');
  });

  it('returns empty string for an empty client id', () => {
    expect(parseAppIdFromClientId('')).toBe('');
  });

  it('does not match digits that are not at the very start', () => {
    expect(parseAppIdFromClientId('abc-123456789012-def.apps.googleusercontent.com')).toBe('');
  });

  it('only takes the digits immediately before the first hyphen', () => {
    expect(parseAppIdFromClientId('123-456-abc.apps.googleusercontent.com')).toBe('123');
  });
});

// The refresh-token request body construction in tick() (triggered
// indirectly via startRefreshLoop, since tick() itself isn't exported).
// Public, PKCE-only providers like PostHog have no client_secret; the
// request must omit the param entirely rather than send it empty, since an
// explicit empty client_secret is itself invalid for some token endpoints.
describe('tick — refresh request body', () => {
  afterEach(() => {
    stopAllRefreshLoops();
    vi.restoreAllMocks();
  });

  async function runOneTick(credsResponse: { client_id: string; client_secret: string }) {
    vi.mocked(getRefreshToken).mockResolvedValue('stored-refresh-token');
    const capturedBodies: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/oauth/') && href.includes('/credentials')) {
        return new Response(JSON.stringify(credsResponse), { status: 200 });
      }
      if (href === 'https://token.example.com/token') {
        return { ok: false, status: 599, json: async () => ({}) } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;

    // expiresAt already inside the pre-refresh window → tick() refreshes
    // immediately instead of waiting out REFRESH_INTERVAL_MS.
    startRefreshLoop('posthog', 'my-posthog-conn', 'user@example.com', new Date().toISOString(), 'https://token.example.com/token');
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const tokenCall = calls.find((args: unknown[]) => args[0] === 'https://token.example.com/token');
      if (!tokenCall) throw new Error('token endpoint not called yet');
      capturedBodies.push((tokenCall[1] as RequestInit).body as string);
    });
    return capturedBodies[0];
  }

  it('omits client_secret entirely for a secret-less provider', async () => {
    const body = await runOneTick({ client_id: 'https://example.com/cimd.json', client_secret: '' });
    const params = new URLSearchParams(body);
    expect(params.has('client_secret')).toBe(false);
    expect(params.get('client_id')).toBe('https://example.com/cimd.json');
  });

  it('includes client_secret for a provider that has one', async () => {
    const body = await runOneTick({ client_id: 'cid-123', client_secret: 'csecret-456' });
    const params = new URLSearchParams(body);
    expect(params.get('client_secret')).toBe('csecret-456');
  });
});

describe('tick — refresh outcomes', () => {
  afterEach(() => {
    stopAllRefreshLoops();
    vi.restoreAllMocks();
  });

  const TOKEN_URL = 'https://token.example.com/token';

  // Records every token-endpoint call and every PATCH /token body, and lets
  // a test script the token endpoint's behaviour call by call.
  function mockServer(tokenEndpoint: Array<() => Response>) {
    const tokenCalls: string[] = [];
    const patches: Record<string, string>[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/credentials')) {
        return new Response(JSON.stringify({ client_id: 'cid', client_secret: '' }), { status: 200 });
      }
      if (href.endsWith('/token') && init?.method === 'PATCH') {
        patches.push(JSON.parse(init.body as string));
        return new Response('{}', { status: 200 });
      }
      if (href === TOKEN_URL) {
        const next = tokenEndpoint[tokenCalls.length];
        tokenCalls.push(init?.body as string);
        if (!next) throw new Error('token endpoint called too many times');
        return next();
      }
      throw new Error(`unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;
    return { tokenCalls, patches };
  }

  it('marks an expired connection with no refresh token needs_reconnect', async () => {
    vi.mocked(getRefreshToken).mockResolvedValue(null);
    const { tokenCalls, patches } = mockServer([]);

    startRefreshLoop('notion', 'my-notion', 'user@example.com:ws-1', new Date(Date.now() - 1000).toISOString(), TOKEN_URL);

    await vi.waitFor(() => expect(patches).toEqual([{ status: 'needs_reconnect' }]));
    expect(tokenCalls).toHaveLength(0);
  });

  it('leaves a not-yet-expired connection with no refresh token alone', async () => {
    vi.mocked(getRefreshToken).mockResolvedValue(null);
    const { patches } = mockServer([]);

    // Inside the pre-refresh window, but not expired.
    startRefreshLoop('notion', 'my-notion', 'user@example.com:ws-1', new Date(Date.now() + 60_000).toISOString(), TOKEN_URL);

    await vi.waitFor(() => expect(vi.mocked(getRefreshToken)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toEqual([]);
  });

  it('retries once immediately with the same token after a network failure', async () => {
    vi.mocked(getRefreshToken).mockResolvedValue('rt-1');
    const { tokenCalls, patches } = mockServer([
      () => { throw new TypeError('fetch failed'); },
      () => new Response(JSON.stringify({ access_token: 'at-2', expires_in: 3600, refresh_token: 'rt-2' }), { status: 200 }),
    ]);

    startRefreshLoop('notion', 'my-notion', 'user@example.com:ws-1', new Date().toISOString(), TOKEN_URL);

    await vi.waitFor(() => expect(patches).toHaveLength(1));
    expect(tokenCalls).toHaveLength(2);
    expect(new URLSearchParams(tokenCalls[1]).get('refresh_token')).toBe('rt-1');
    expect(patches[0].access_token).toBe('at-2');
    expect(vi.mocked(setRefreshToken)).toHaveBeenCalledWith('notion', 'user@example.com:ws-1', 'rt-2');
  });

  it('does not retry an invalid_grant', async () => {
    vi.mocked(getRefreshToken).mockResolvedValue('rt-1');
    const { tokenCalls, patches } = mockServer([
      () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    ]);

    startRefreshLoop('notion', 'my-notion', 'user@example.com:ws-1', new Date().toISOString(), TOKEN_URL);

    await vi.waitFor(() => expect(patches).toEqual([{ status: 'needs_reconnect' }]));
    expect(tokenCalls).toHaveLength(1);
  });
});
