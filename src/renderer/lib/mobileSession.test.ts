import { describe, expect, it, vi } from 'vitest';
import {
  serializedMobileSessionStore,
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

  it('still shows sign-in when a revoked session cannot be cleared', async () => {
    const { store } = memoryStore();
    store.clearSession.mockRejectedValueOnce(new Error('keystore unavailable'));
    const { result } = restore(store, json({ error: 'invalid_grant' }, 400));
    expect(await result).toEqual({ kind: 'none' });
  });

  it('keeps the session when Keycloak cannot be reached', async () => {
    for (const response of [new TypeError('offline'), json({}, 503)]) {
      const { store, current } = memoryStore();
      const { result } = restore(store, response);
      expect(await result).toEqual({ kind: 'unavailable' });
      expect(current()).toEqual(SAVED);
    }
  });

  it.each(['headers', 'body'] as const)('keeps the session and offers a retry when response %s stall', async (phase) => {
    vi.useFakeTimers();
    try {
      const { store, current } = memoryStore();
      let settled = false;
      const result = restoreMobileSession({
        store,
        tokenUrl: TOKEN_URL,
        clientId: 'cowork-mobile',
        timeoutMs: 100,
        fetch: vi.fn(async (_url, init) => {
          const stalled = new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          });
          if (phase === 'headers') return stalled;
          const response = new Response('{}');
          vi.spyOn(response, 'json').mockReturnValue(stalled);
          return response;
        }) as typeof fetch,
      }).then((value) => { settled = true; return value; });

      await vi.advanceTimersByTimeAsync(99);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect(await result).toEqual({ kind: 'unavailable' });
      expect(current()).toEqual(SAVED);
      expect(store.clearSession).not.toHaveBeenCalled();
      expect(store.saveSession).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
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

  it('keeps save best-effort but propagates a failed clear', async () => {
    const { store } = memoryStore();
    store.saveSession.mockRejectedValueOnce(new Error('full'));
    store.clearSession.mockRejectedValueOnce(new Error('locked'));
    await expect(saveMobileSession(store, SAVED)).resolves.toBeUndefined();
    await expect(clearMobileSession(store)).rejects.toThrow('locked');
    await expect(clearMobileSession(null)).resolves.toBeUndefined();
  });
});

describe('serializedMobileSessionStore', () => {
  it('finishes an in-flight save before clearing, including reads after logout', async () => {
    const memory = memoryStore(null);
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    const originalSave = memory.store.saveSession;
    const store = serializedMobileSessionStore({
      ...memory.store,
      saveSession: async (options) => { await stalled; return originalSave(options); },
    });
    const save = store.saveSession({ session: JSON.stringify(SAVED) });
    const clear = store.clearSession();
    const read = store.loadSession();
    expect(memory.store.clearSession).not.toHaveBeenCalled();
    release();
    await Promise.all([save, clear]);
    expect(await read).toEqual({});
  });

  it('ignores a token refresh delivered after sign-out has begun', async () => {
    const memory = memoryStore();
    const store = serializedMobileSessionStore(memory.store);
    const clearing = store.clearSession();
    await store.saveSession({ session: JSON.stringify(SAVED) });
    await clearing;
    expect(memory.current()).toBeNull();
    expect(memory.store.saveSession).not.toHaveBeenCalled();
  });

  it('still clears after a rejected save', async () => {
    const memory = memoryStore();
    const store = serializedMobileSessionStore({ ...memory.store, saveSession: async () => { throw new Error('disk'); } });
    await expect(store.saveSession({ session: 'unused' })).rejects.toThrow('disk');
    await store.clearSession();
    expect(memory.current()).toBeNull();
  });
});
