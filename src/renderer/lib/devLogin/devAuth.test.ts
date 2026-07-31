import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Keycloak from 'keycloak-js';

import {
  DEV_AUTH_STORAGE_KEY,
  applyDevTokens,
  clearDevTokens,
  decodeJwtPayload,
  getStoredDevTokens,
  patchKeycloakForDev,
} from './devAuth';

/** base64url-encode a string (JWT segments use base64url, no padding). */
function b64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a minimal signed-looking JWT with the given payload claims. */
function makeJwt(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.sig`;
}

function fakeKeycloak(): Keycloak {
  return {} as Keycloak;
}

describe('decodeJwtPayload', () => {
  it('decodes the payload of a valid JWT', () => {
    const jwt = makeJwt({ sub: 'user-1', foo: 'bar' });
    expect(decodeJwtPayload(jwt)).toMatchObject({ sub: 'user-1', foo: 'bar' });
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });
});

describe('applyDevTokens', () => {
  it('sets tokens and hoists identity claims onto the keycloak instance', () => {
    const kc = fakeKeycloak();
    const token = makeJwt({
      sub: 'user-9',
      realm_access: { roles: ['dev'] },
      resource_access: { 'public-client': { roles: ['x'] } },
    });
    applyDevTokens(kc, { token, refreshToken: 'r', idToken: makeJwt({ sub: 'user-9' }) });

    expect(kc.authenticated).toBe(true);
    expect(kc.token).toBe(token);
    expect(kc.refreshToken).toBe('r');
    expect(kc.subject).toBe('user-9');
    expect(kc.realmAccess).toEqual({ roles: ['dev'] });
    expect(kc.resourceAccess).toEqual({ 'public-client': { roles: ['x'] } });
  });
});

describe('stored dev tokens', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage and clears', () => {
    expect(getStoredDevTokens()).toBeNull();
    localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify({ token: 't' }));
    expect(getStoredDevTokens()).toEqual({ token: 't' });
    clearDevTokens();
    expect(getStoredDevTokens()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    localStorage.setItem(DEV_AUTH_STORAGE_KEY, '{not json');
    expect(getStoredDevTokens()).toBeNull();
  });
});

describe('patchKeycloakForDev', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('replaces init() with a resolved no-op that fires onReady', async () => {
    const kc = fakeKeycloak();
    const onReady = vi.fn();
    kc.onReady = onReady;
    patchKeycloakForDev(
      kc,
      { clientId: 'public-client', realm: 'mindsdb', tokenEndpoint: '/auth/token' },
      { token: makeJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 3600 }) },
    );

    expect(kc.realm).toBe('mindsdb');
    expect(kc.clientId).toBe('public-client');
    await expect(kc.init({} as never)).resolves.toBe(true);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(true));
  });

  it('updateToken does not refresh while the token is still valid', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const kc = fakeKeycloak();
    patchKeycloakForDev(
      kc,
      { clientId: 'public-client', realm: 'mindsdb', tokenEndpoint: '/auth/token' },
      { token: makeJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 3600 }) },
    );

    await expect(kc.updateToken(30)).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('updateToken refreshes via the token endpoint once the token is stale', async () => {
    const newToken = makeJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 3600 });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: newToken, refresh_token: 'r2', id_token: 'i2' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const kc = fakeKeycloak();
    patchKeycloakForDev(
      kc,
      { clientId: 'public-client', realm: 'mindsdb', tokenEndpoint: '/auth/token' },
      { token: makeJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) - 10 }), refreshToken: 'r1' },
    );

    await expect(kc.updateToken(30)).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('/auth/token', expect.objectContaining({ method: 'POST' }));
    expect(kc.token).toBe(newToken);
    expect(getStoredDevTokens()).toEqual({ token: newToken, refreshToken: 'r2', idToken: 'i2' });
  });
});
