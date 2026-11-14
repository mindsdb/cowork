// The adapter against the real keycloak-js, not a mock: the fragment replay
// only works if keycloak-js's own init() picks the callback up from this page's
// URL and exchanges the code with what createLoginUrl stored. A keycloak-js
// upgrade that changes either side fails here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Keycloak from 'keycloak-js';
import {
  MOBILE_AUTH_REDIRECT_URI,
  MOBILE_KEYCLOAK_CLIENT_ID,
  createMobileShellAdapter,
  keycloakInitOptions,
} from './mobileAuth';

const KEYCLOAK_URL = 'https://auth.example/auth';
const REALM_URL = `${KEYCLOAK_URL}/realms/mindsdb`;

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeJwt(claims: object): string {
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url(claims)}.sig`;
}

function newClient() {
  return new Keycloak({ url: KEYCLOAK_URL, realm: 'mindsdb', clientId: MOBILE_KEYCLOAK_CLIENT_ID });
}

describe('mobile adapter with keycloak-js', () => {
  const startHref = window.location.href;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/c/42');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', startHref);
    window.localStorage.clear();
  });

  it('signs in through the sheet, then init() on reload exchanges the code', async () => {
    // First page load: no callback, no onLoad, so nothing navigates.
    const first = newClient();
    let replayed = '';
    let authorizeUrl = '';
    const adapter = createMobileShellAdapter({
      keycloak: first,
      logoutUrl: `${REALM_URL}/protocol/openid-connect/logout`,
      getPlugin: () => ({
        authenticate: async ({ url }) => {
          authorizeUrl = url;
          const state = new URL(url).searchParams.get('state');
          return { url: `${MOBILE_AUTH_REDIRECT_URI}#state=${state}&session_state=ss-1&iss=${encodeURIComponent(REALM_URL)}&code=code-1` };
        },
      }),
      replayCallback: (url) => { replayed = url; },
    });
    const pageUrl = `${window.location.origin}/c/42`;
    expect(await first.init(keycloakInitOptions(pageUrl, adapter))).toBe(false);

    await first.login();

    const authorize = new URL(authorizeUrl);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${REALM_URL}/protocol/openid-connect/auth`);
    expect(authorize.searchParams.get('client_id')).toBe('cowork-mobile');
    expect(authorize.searchParams.get('redirect_uri')).toBe(MOBILE_AUTH_REDIRECT_URI);
    expect(authorize.searchParams.get('response_mode')).toBe('fragment');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(replayed.startsWith(`${pageUrl}#`)).toBe(true);

    // The reload: a fresh client on the replayed URL, like a new page.
    window.history.replaceState(null, '', replayed);
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: fakeJwt({ sub: 'user-1', exp: now + 300, iat: now }),
      refresh_token: fakeJwt({ sub: 'user-1', exp: now + 1800, iat: now }),
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const second = newClient();
    const secondAdapter = createMobileShellAdapter({ keycloak: second, logoutUrl: `${REALM_URL}/protocol/openid-connect/logout` });
    expect(await second.init(keycloakInitOptions(pageUrl, secondAdapter))).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [tokenUrl, init] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toBe(`${REALM_URL}/protocol/openid-connect/token`);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('code')).toBe('code-1');
    expect(body.get('client_id')).toBe('cowork-mobile');
    // The exchange names the same redirect URI as the authorize request.
    expect(body.get('redirect_uri')).toBe(MOBILE_AUTH_REDIRECT_URI);
    expect(body.get('code_verifier')).toBeTruthy();
    expect(second.subject).toBe('user-1');
    // keycloak-js takes its params back out of the address bar.
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/c/42');
  });

  it('does not open anything on load in the app', async () => {
    const client = newClient();
    const authenticate = vi.fn();
    const adapter = createMobileShellAdapter({
      keycloak: client,
      logoutUrl: `${REALM_URL}/protocol/openid-connect/logout`,
      getPlugin: () => ({ authenticate }),
      replayCallback: vi.fn(),
    });

    expect(await client.init(keycloakInitOptions(window.location.href, adapter))).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
