import { describe, expect, it, vi } from 'vitest';
import {
  clearMobileSession,
  getMobileSessionStore,
  restoreMobileSession,
  saveMobileSession,
  type MobileSessionStore,
} from './mobileSession';

const TOKEN_URL = 'https://auth.example/auth/realms/mindsdb/protocol/openid-connect/token';
const SAVED = { token: 'at-old', refreshToken: 'rt-old', idToken: 'id-old' };

function memoryStore(initial: string | null = JSON.stringify(SAVED)) {
  let value = initial;
  const store = {
    loadSession: vi.fn(async () => (value === null ? {} : { session: value })),
    saveSession: vi.fn(async ({ session }: { session: string }) => { value = session; }),
    clearSession: vi.fn(async () => { value = null; }),
  } satisfies MobileSessionStore;
  return { store, current: () => (value === null ? null : JSON.parse(value)) };
}

function restore(store: MobileSessionStore | null, response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const result = restoreMobileSession({
    store,
    tokenUrl: TOKEN_URL,
    clientId: 'cowork-mobile',
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { result, fetchMock };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('getMobileSessionStore', () => {
  it('finds the session methods on the native plugin', () => {
    const { store } = memoryStore();
    expect(getMobileSessionStore({ Capacitor: { Plugins: { MindsHubAuth: store } } })).toBe(store);
  });

  it('is null in a shell whose plugin predates them, or outside the app', () => {
    expect(getMobileSessionStore({ Capacitor: { Plugins: { MindsHubAuth: { authenticate: () => {} } } } })).toBeNull();
    expect(getMobileSessionStore({})).toBeNull();
    expect(getMobileSessionStore(undefined)).toBeNull();
  });
});

describe('restoreMobileSession', () => {
  it('refreshes the saved session and starts signed in with the new tokens, saving them', async () => {
    const { store, current } = memoryStore();
    const { result, fetchMock } = restore(store, json({ access_token: 'at-new', refresh_token: 'rt-new', id_token: 'id-new' }));

    expect(await result).toEqual({ kind: 'restored', session: { token: 'at-new', refreshToken: 'rt-new', idToken: 'id-new' } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TOKEN_URL);
    expect(String(init.body)).toBe('grant_type=refresh_token&client_id=cowork-mobile&refresh_token=rt-old');
    expect(current()).toEqual({ token: 'at-new', refreshToken: 'rt-new', idToken: 'id-new' });
  });

  it('keeps the saved id token when the refresh returns none', async () => {
    const { store } = memoryStore();
    const { result } = restore(store, json({ access_token: 'at-new', refresh_token: 'rt-new' }));
    expect(await result).toEqual({ kind: 'restored', session: { token: 'at-new', refreshToken: 'rt-new', idToken: 'id-old' } });
  });

  it('clears an expired or revoked session, so the app shows sign-in', async () => {
    const { store, current } = memoryStore();
    const { result } = restore(store, json({ error: 'invalid_grant' }, 400));
    expect(await result).toEqual({ kind: 'none' });
    expect(current()).toBeNull();
  });

  it('keeps the session when Keycloak cannot be reached', async () => {
    for (const response of [new TypeError('offline'), json({}, 503)]) {
      const { store, current } = memoryStore();
      const { result } = restore(store, response);
      expect(await result).toEqual({ kind: 'unavailable' });
      expect(current()).toEqual(SAVED);
    }
  });

  it('does not call Keycloak with nothing saved, a corrupt save, or no store', async () => {
    for (const saved of [null, 'not json', JSON.stringify({ token: 'at-only' })]) {
      const { store } = memoryStore(saved);
      const { result, fetchMock } = restore(store, json({}));
      expect(await result).toEqual({ kind: 'none' });
      expect(fetchMock).not.toHaveBeenCalled();
    }
    expect(await restore(null, json({})).result).toEqual({ kind: 'none' });
  });

  it('treats a store that fails to read as nothing saved', async () => {
    const { store } = memoryStore();
    store.loadSession.mockRejectedValueOnce(new Error('keychain locked'));
    expect(await restore(store, json({})).result).toEqual({ kind: 'none' });
  });
});

describe('saveMobileSession / clearMobileSession', () => {
  it('saves only a complete session', async () => {
    const { store, current } = memoryStore(null);
    await saveMobileSession(store, { token: 'at' });
    expect(store.saveSession).not.toHaveBeenCalled();
    await saveMobileSession(store, { token: 'at', refreshToken: 'rt' });
    expect(current()).toEqual({ token: 'at', refreshToken: 'rt' });
  });

  it('never rejects', async () => {
    const { store } = memoryStore();
    store.saveSession.mockRejectedValueOnce(new Error('full'));
    store.clearSession.mockRejectedValueOnce(new Error('locked'));
    await expect(saveMobileSession(store, SAVED)).resolves.toBeUndefined();
    await expect(clearMobileSession(store)).resolves.toBeUndefined();
    await expect(clearMobileSession(null)).resolves.toBeUndefined();
  });
});
