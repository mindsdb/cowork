// The completion page against the real keycloak-js, not a mock: Keycloak's
// sign-in returns to the same page with its code in the fragment, and the
// capture must leave that fragment for init() to exchange.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Keycloak from 'keycloak-js';
import { keycloakInitOptions } from '../../lib/mobileAuth';
import { CUSTOM_MCP_FINISH_PATH, captureCustomMcpCompletion, takeCustomMcpCompletion } from './customMcpFinish';

const KEYCLOAK_URL = 'https://auth.example/auth';
const REALM_URL = `${KEYCLOAK_URL}/realms/mindsdb`;
const ID = 'A'.repeat(21) + '_-' + 'b'.repeat(20);

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeJwt(claims: object): string {
  return `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url(claims)}.sig`;
}

function newClient() {
  return new Keycloak({ url: KEYCLOAK_URL, realm: 'mindsdb', clientId: 'cowork-web' });
}

describe('the completion page with keycloak-js', () => {
  const startHref = window.location.href;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', startHref);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps the id across Keycloak sign-in, and init() exchanges the code it returns with', async () => {
    const pageUrl = `${window.location.origin}${CUSTOM_MCP_FINISH_PATH}`;
    // First load: auth's redirect with the completion id.
    window.history.replaceState(null, '', `${CUSTOM_MCP_FINISH_PATH}#${ID}`);
    captureCustomMcpCompletion();
    expect(window.location.hash).toBe('');

    // The login redirect keycloak-js would make, with the state it stores for the return.
    const first = newClient();
    expect(await first.init({ pkceMethod: 'S256', checkLoginIframe: false, redirectUri: pageUrl })).toBe(false);
    const state = new URL(await first.createLoginUrl({ redirectUri: pageUrl })).searchParams.get('state');

    // Keycloak's return: the same page, its code in the fragment, and the capture runs again.
    const callback = `#state=${state}&session_state=ss-1&iss=${encodeURIComponent(REALM_URL)}&code=code-1`;
    window.history.replaceState(null, '', `${CUSTOM_MCP_FINISH_PATH}${callback}`);
    captureCustomMcpCompletion();
    expect(window.location.hash).toBe(callback);

    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: fakeJwt({ sub: 'user-1', exp: now + 300, iat: now }),
      refresh_token: fakeJwt({ sub: 'user-1', exp: now + 1800, iat: now }),
      token_type: 'Bearer',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const second = newClient();
    const login = vi.fn(async () => {});
    second.login = login;

    expect(await second.init(keycloakInitOptions(pageUrl, null))).toBe(true);
    expect(login).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${REALM_URL}/protocol/openid-connect/token`);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('code')).toBe('code-1');
    expect(takeCustomMcpCompletion()).toBe(ID);
  });
});
