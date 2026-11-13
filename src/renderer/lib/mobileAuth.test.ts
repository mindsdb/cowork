import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_AUTH_CALLBACK_SCHEME,
  MOBILE_AUTH_REDIRECT_URI,
  MOBILE_KEYCLOAK_CLIENT_ID,
  buildCallbackReplayUrl,
  createMobileShellAdapter,
  extractCallbackParams,
  getMindsHubAuthPlugin,
  isAuthCancelled,
  keycloakInitOptions,
  type MindsHubAuthPlugin,
  type MobileAdapterKeycloak,
} from './mobileAuth';

const LOGOUT_URL = 'https://auth.example/auth/realms/mindsdb/protocol/openid-connect/logout';
const PAGE = 'https://cowork.mindshub.ai/';

describe('shared contract constants', () => {
  it('match what the native shell and Keycloak are configured with', () => {
    expect(MOBILE_KEYCLOAK_CLIENT_ID).toBe('cowork-mobile');
    expect(MOBILE_AUTH_CALLBACK_SCHEME).toBe('ai.mindshub.cowork');
    expect(MOBILE_AUTH_REDIRECT_URI).toBe('ai.mindshub.cowork://auth/callback');
  });
});

describe('extractCallbackParams', () => {
  it('reads a fragment callback (keycloak-js default response mode)', () => {
    const params = extractCallbackParams(
      'ai.mindshub.cowork://auth/callback#state=s1&session_state=ss&iss=https%3A%2F%2Fauth.example%2Frealms%2Fmindsdb&code=c1',
    );
    expect(params?.toString()).toBe('code=c1&state=s1&session_state=ss&iss=https%3A%2F%2Fauth.example%2Frealms%2Fmindsdb');
  });

  it('reads a query callback', () => {
    const params = extractCallbackParams('ai.mindshub.cowork://auth/callback?code=c1&state=s1');
    expect(params?.toString()).toBe('code=c1&state=s1');
  });

  it('prefers the fragment when both carry a param', () => {
    const params = extractCallbackParams('ai.mindshub.cowork://auth/callback?state=old&code=old#state=s1&code=c1');
    expect(params?.get('state')).toBe('s1');
    expect(params?.get('code')).toBe('c1');
  });

  it('keeps an error callback so keycloak-js reports it', () => {
    const params = extractCallbackParams('ai.mindshub.cowork://auth/callback#error=access_denied&error_description=nope&state=s1');
    expect(params?.toString()).toBe('state=s1&error=access_denied&error_description=nope');
  });

  it('drops params keycloak-js does not read', () => {
    const params = extractCallbackParams('ai.mindshub.cowork://auth/callback#code=c1&state=s1&evil=1&redirect=x');
    expect(params?.toString()).toBe('code=c1&state=s1');
  });

  it('is null for a URL that is not a callback', () => {
    expect(extractCallbackParams('ai.mindshub.cowork://auth/callback')).toBeNull();
    expect(extractCallbackParams('ai.mindshub.cowork://auth/callback#code=c1')).toBeNull();
    expect(extractCallbackParams('ai.mindshub.cowork://auth/callback#state=s1')).toBeNull();
    expect(extractCallbackParams('not a url')).toBeNull();
    expect(extractCallbackParams('')).toBeNull();
  });
});

describe('buildCallbackReplayUrl', () => {
  const params = new URLSearchParams('code=c1&state=s1');

  it('puts the params in the fragment by default', () => {
    expect(buildCallbackReplayUrl('https://cowork.mindshub.ai/c/42', params)).toBe('https://cowork.mindshub.ai/c/42#code=c1&state=s1');
  });

  it('replaces a fragment the page already had', () => {
    expect(buildCallbackReplayUrl('https://cowork.mindshub.ai/#stale', params, 'fragment')).toBe('https://cowork.mindshub.ai/#code=c1&state=s1');
  });

  it('puts the params in the query for responseMode query, keeping other params', () => {
    expect(buildCallbackReplayUrl('https://cowork.mindshub.ai/?tab=1', params, 'query')).toBe('https://cowork.mindshub.ai/?tab=1&code=c1&state=s1');
  });
});

describe('getMindsHubAuthPlugin / isAuthCancelled', () => {
  it('finds the plugin on window.Capacitor', () => {
    const plugin = { authenticate: vi.fn() };
    expect(getMindsHubAuthPlugin({ Capacitor: { Plugins: { MindsHubAuth: plugin } } })).toBe(plugin);
  });

  it('is null without Capacitor or without the plugin', () => {
    expect(getMindsHubAuthPlugin({})).toBeNull();
    expect(getMindsHubAuthPlugin({ Capacitor: { Plugins: {} } })).toBeNull();
    expect(getMindsHubAuthPlugin({ Capacitor: { Plugins: { MindsHubAuth: {} } } })).toBeNull();
    expect(getMindsHubAuthPlugin(undefined)).toBeNull();
  });

  it('recognizes only the CANCELLED code', () => {
    expect(isAuthCancelled({ code: 'CANCELLED' })).toBe(true);
    expect(isAuthCancelled(Object.assign(new Error('x'), { code: 'CANCELLED' }))).toBe(true);
    expect(isAuthCancelled({ code: 'FAILED' })).toBe(false);
    expect(isAuthCancelled(new Error('CANCELLED'))).toBe(false);
    expect(isAuthCancelled(null)).toBe(false);
  });
});

function setup(overrides: {
  authenticate?: MindsHubAuthPlugin['authenticate'] | null;
  keycloak?: Partial<MobileAdapterKeycloak>;
  beforeLogout?: () => Promise<void>;
  beforeLogoutTimeoutMs?: number;
} = {}) {
  const keycloak: MobileAdapterKeycloak = {
    createLoginUrl: vi.fn(async () => 'https://auth.example/login?state=s1'),
    createRegisterUrl: vi.fn(async () => 'https://auth.example/registrations?state=s1'),
    clearToken: vi.fn(),
    responseMode: 'fragment',
    clientId: MOBILE_KEYCLOAK_CLIENT_ID,
    ...overrides.keycloak,
  };
  const authenticate = overrides.authenticate === undefined
    ? vi.fn(async () => ({ url: 'ai.mindshub.cowork://auth/callback#state=s1&session_state=ss&code=c1' }))
    : overrides.authenticate;
  const replayCallback = vi.fn();
  const navigate = vi.fn();
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  const adapter = createMobileShellAdapter({
    keycloak,
    logoutUrl: LOGOUT_URL,
    getPlugin: () => (authenticate ? { authenticate } : null),
    currentHref: () => PAGE,
    replayCallback,
    navigate,
    fetch: fetchMock as unknown as typeof fetch,
    beforeLogout: overrides.beforeLogout,
    beforeLogoutTimeoutMs: overrides.beforeLogoutTimeoutMs,
  });
  return { adapter, keycloak, authenticate, replayCallback, navigate, fetchMock };
}

describe('createMobileShellAdapter', () => {
  it('signs in through the sheet and replays the callback on this page', async () => {
    const { adapter, keycloak, authenticate, replayCallback } = setup();

    await adapter.login({ redirectUri: 'https://cowork.mindshub.ai/', prompt: 'login' });

    // The web redirect a caller passes is overridden: the authorize request,
    // and the redirect keycloak-js stores for the code exchange, name the app's.
    expect(keycloak.createLoginUrl).toHaveBeenCalledWith({ redirectUri: MOBILE_AUTH_REDIRECT_URI, prompt: 'login' });
    expect(authenticate).toHaveBeenCalledWith({ url: 'https://auth.example/login?state=s1', callbackScheme: 'ai.mindshub.cowork' });
    expect(replayCallback).toHaveBeenCalledWith(`${PAGE}#code=c1&state=s1&session_state=ss`);
  });

  it('signs up through the registration URL', async () => {
    const { adapter, keycloak, authenticate, replayCallback } = setup();

    await adapter.register();

    expect(keycloak.createRegisterUrl).toHaveBeenCalledWith({ redirectUri: MOBILE_AUTH_REDIRECT_URI });
    expect(keycloak.createLoginUrl).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledWith({ url: 'https://auth.example/registrations?state=s1', callbackScheme: 'ai.mindshub.cowork' });
    expect(replayCallback).toHaveBeenCalledTimes(1);
  });

  it('honors responseMode query', async () => {
    const { adapter, replayCallback } = setup({ keycloak: { responseMode: 'query' } });
    await adapter.login();
    expect(replayCallback).toHaveBeenCalledWith(`${PAGE}?code=c1&state=s1&session_state=ss`);
  });

  it('resolves quietly when the user closes the sheet, so the sign-in screen stays', async () => {
    const authenticate = vi.fn(async () => { throw Object.assign(new Error('closed'), { code: 'CANCELLED' }); });
    const { adapter, replayCallback } = setup({ authenticate });

    await expect(adapter.login()).resolves.toBeUndefined();
    expect(replayCallback).not.toHaveBeenCalled();
  });

  it('rejects on any other plugin failure', async () => {
    const authenticate = vi.fn(async () => { throw Object.assign(new Error('boom'), { code: 'FAILED' }); });
    const { adapter, replayCallback } = setup({ authenticate });

    await expect(adapter.login()).rejects.toThrow('boom');
    expect(replayCallback).not.toHaveBeenCalled();
  });

  it('rejects a sheet that returns something other than a callback', async () => {
    const authenticate = vi.fn(async () => ({ url: 'ai.mindshub.cowork://auth/callback' }));
    const { adapter, replayCallback } = setup({ authenticate });

    await expect(adapter.login()).rejects.toThrow('Sign-in did not finish');
    expect(replayCallback).not.toHaveBeenCalled();
  });

  it('rejects without the native plugin, before creating any callback state', async () => {
    const { adapter, keycloak } = setup({ authenticate: null });

    await expect(adapter.login()).rejects.toThrow('not available');
    expect(keycloak.createLoginUrl).not.toHaveBeenCalled();
  });

  it('ends the Keycloak session with the refresh token, then clears and leaves', async () => {
    const { adapter, keycloak, fetchMock, navigate } = setup({ keycloak: { refreshToken: 'rt-1' } });

    await adapter.logout({ redirectUri: 'https://cowork.mindshub.ai/c/1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LOGOUT_URL);
    expect(init.method).toBe('POST');
    expect(String(init.body)).toBe('client_id=cowork-mobile&refresh_token=rt-1');
    expect(keycloak.clearToken).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('https://cowork.mindshub.ai/c/1');
  });

  it('still signs out locally when ending the session fails', async () => {
    const { adapter, keycloak, fetchMock, navigate } = setup({ keycloak: { refreshToken: 'rt-1' } });
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await adapter.logout({ redirectUri: PAGE });

    expect(keycloak.clearToken).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(PAGE);
  });

  it('skips the session call without a refresh token', async () => {
    const { adapter, fetchMock, keycloak } = setup();
    await adapter.logout({ redirectUri: PAGE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keycloak.clearToken).toHaveBeenCalled();
  });

  it('runs beforeLogout (push unregister) before the session ends and the tokens are cleared', async () => {
    const order: string[] = [];
    const beforeLogout = vi.fn(async () => { order.push('beforeLogout'); });
    const { adapter, keycloak, fetchMock } = setup({ keycloak: { refreshToken: 'rt-1' }, beforeLogout });
    fetchMock.mockImplementation(async () => { order.push('end-session'); return new Response(null, { status: 204 }); });
    vi.mocked(keycloak.clearToken).mockImplementation(() => { order.push('clearToken'); });

    await adapter.logout({ redirectUri: PAGE });

    expect(order).toEqual(['beforeLogout', 'end-session', 'clearToken']);
  });

  it('signs out even when beforeLogout fails', async () => {
    const { adapter, keycloak, navigate } = setup({ beforeLogout: async () => { throw new Error('offline'); } });
    await adapter.logout({ redirectUri: PAGE });
    expect(keycloak.clearToken).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(PAGE);
  });

  it('does not wait on a hung beforeLogout past its timeout', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, keycloak } = setup({ beforeLogout: () => new Promise<void>(() => {}), beforeLogoutTimeoutMs: 3_000 });
      const done = adapter.logout({ redirectUri: PAGE });
      await vi.advanceTimersByTimeAsync(2_999);
      expect(keycloak.clearToken).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(keycloak.clearToken).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the app's redirect URI unless told otherwise", () => {
    const { adapter } = setup();
    expect(adapter.redirectUri()).toBe(MOBILE_AUTH_REDIRECT_URI);
    expect(adapter.redirectUri({ redirectUri: 'x://y' })).toBe('x://y');
  });

  it('has no account management in the app', async () => {
    const { adapter } = setup();
    await expect(adapter.accountManagement()).rejects.toThrow();
  });
});

describe('keycloakInitOptions', () => {
  it('is exactly the web options outside the app', () => {
    expect(keycloakInitOptions('https://cowork.mindshub.ai/', null)).toStrictEqual({
      onLoad: 'login-required',
      pkceMethod: 'S256',
      checkLoginIframe: false,
      redirectUri: 'https://cowork.mindshub.ai/',
    });
    expect(keycloakInitOptions('https://cowork.mindshub.ai/', undefined)).toStrictEqual(
      keycloakInitOptions('https://cowork.mindshub.ai/', null),
    );
  });

  it('in the app, uses the adapter and never logs in on load', () => {
    const { adapter } = setup();
    const options = keycloakInitOptions('https://cowork.mindshub.ai/', adapter);
    expect(options).toStrictEqual({ onLoad: undefined, pkceMethod: 'S256', checkLoginIframe: false, adapter });
  });
});
