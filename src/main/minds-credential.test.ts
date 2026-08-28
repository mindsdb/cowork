import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock('./token-store', () => ({
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  isAccessTokenExpired: vi.fn(() => false),
}));
vi.mock('./server-process', () => ({
  getServerPort: vi.fn(() => 8765),
  isServerRunning: vi.fn(() => true),
  isServerStarting: vi.fn(() => false),
}));
vi.mock('./server-auth', () => ({
  authHeader: () => ({ Authorization: 'Bearer owner-token' }),
}));
vi.mock('./keychain-service', () => ({
  getMindsApiKey: vi.fn(async () => null),
  setMindsApiKey: vi.fn(async () => {}),
  deleteMindsApiKey: vi.fn(async () => {}),
}));

import { getAccessToken, getRefreshToken, isAccessTokenExpired } from './token-store';
import { getServerPort, isServerRunning, isServerStarting } from './server-process';
import { getMindsApiKey, setMindsApiKey, deleteMindsApiKey } from './keychain-service';
import {
  establishMindsCredential,
  resolveMindsCredential,
  pushMindsCredential,
  syncMindsCredential,
  setUserSuppliedMindsKey,
  clearUserSuppliedMindsKey,
  forgetMindsCredential,
} from './minds-credential';

interface Call { method: string; url: string; body?: string; auth?: string }

function installFetch(status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      method: (init?.method || 'GET').toUpperCase(),
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : undefined,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getAccessToken as Mock).mockReturnValue('session-token');
  (getMindsApiKey as Mock).mockResolvedValue(null);
  (isServerRunning as Mock).mockReturnValue(true);
  (isServerStarting as Mock).mockReturnValue(false);
  (getServerPort as Mock).mockReturnValue(8765);
  (getRefreshToken as Mock).mockReturnValue('a-refresh-token');
  (isAccessTokenExpired as Mock).mockReturnValue(false);
});

describe('resolveMindsCredential', () => {
  it('presents the session token when the user supplied no key of their own', async () => {
    expect(await resolveMindsCredential()).toBe('session-token');
  });

  it('prefers a user-supplied key over the session token', async () => {
    // An explicit choice: someone who pasted their own key expects their turns
    // to run on it even while they are also signed in.
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    expect(await resolveMindsCredential()).toBe('mdb_users_own');
  });

  it('has nothing to present when signed out with no key stored', async () => {
    (getAccessToken as Mock).mockReturnValue(null);
    expect(await resolveMindsCredential()).toBeNull();
  });
});

describe('pushMindsCredential', () => {
  it('PUTs the value to the sidecar carrying the server bearer token', async () => {
    // authHeader() matters: a main-process fetch never passes through the
    // renderer's webRequest injection hook, so without it the PUT 401s under
    // COWORK_REQUIRE_AUTH and the app looks unconfigured with no visible cause.
    const calls = installFetch();
    expect(await pushMindsCredential('a-token')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('http://127.0.0.1:8765/api/v1/runtime-credential/minds');
    expect(calls[0].auth).toBe('Bearer owner-token');
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'a-token' });
  });

  it('sends a blank value to clear, never the literal null', async () => {
    const calls = installFetch();
    await pushMindsCredential(null);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });

  it('does not call a sidecar that reports running with no port yet', async () => {
    // startServer resolves the port after the process is up, so there is a
    // window where the flags say running and the port is still 0. Sending to
    // `127.0.0.1:0` would hang the caller rather than fail.
    (getServerPort as Mock).mockReturnValue(0);
    const calls = installFetch();
    expect(await pushMindsCredential('a-token')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('does not call a sidecar that is down', async () => {
    (isServerRunning as Mock).mockReturnValue(false);
    (isServerStarting as Mock).mockReturnValue(false);
    const calls = installFetch();
    expect(await pushMindsCredential('a-token')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a refusal rather than throwing', async () => {
    installFetch(401);
    expect(await pushMindsCredential('a-token')).toBe(false);
  });

  it('reports a network failure rather than throwing', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await pushMindsCredential('a-token')).toBe(false);
  });
});

describe('syncMindsCredential', () => {
  it('hands over whatever resolveMindsCredential picked', async () => {
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    const calls = installFetch();
    await syncMindsCredential();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'mdb_users_own' });
  });

  it('never rejects, because two callers start it with void', async () => {
    // The refresh path and the invalid-grant path both fire this without
    // awaiting, so a rejection surfaces as an unhandled promise rejection in
    // the main process rather than as a failed push.
    (getMindsApiKey as Mock).mockRejectedValue(new Error('keychain exploded'));
    installFetch();
    await expect(syncMindsCredential()).resolves.toBe(true);
  });

  it('falls back to the session token when the keychain cannot be read', async () => {
    // Both stores failing must not cost a signed-in user their credential too.
    (getMindsApiKey as Mock).mockRejectedValue(new Error('no secret service'));
    const calls = installFetch();
    await syncMindsCredential();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'session-token' });
  });
});

describe('a user-supplied key', () => {
  it('is stored in the keychain and handed over immediately', async () => {
    const calls = installFetch();
    expect(await setUserSuppliedMindsKey('mdb_pasted')).toBe(true);
    expect(setMindsApiKey).toHaveBeenCalledWith('mdb_pasted');
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'mdb_pasted' });
  });

  it('falls back to the session credential when removed', async () => {
    // Without the push, the sidecar would keep running on the key the user just
    // removed until something else happened to push.
    const calls = installFetch();
    await clearUserSuppliedMindsKey();
    expect(deleteMindsApiKey).toHaveBeenCalled();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'session-token' });
  });
});

describe('forgetMindsCredential (sign-out)', () => {
  it('still clears the sidecar when the keychain delete throws', async () => {
    // keychain-fallback's write is unguarded, so on a machine with no OS secure
    // store this can throw. Letting it through would skip the step that
    // actually stops this install's turns — and, at the sign-out call site,
    // everything after it too.
    (deleteMindsApiKey as Mock).mockRejectedValue(new Error('no secret service'));
    const calls = installFetch();

    await expect(forgetMindsCredential()).resolves.toBeUndefined();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });

  it('clears the keychain AND the sidecar, not one or the other', async () => {
    // Clearing the sidecar alone leaves the keychain entry, and the next
    // sidecar start pushes it straight back — a signed-out install quietly
    // running on a credential again.
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    const calls = installFetch();
    await forgetMindsCredential();
    expect(deleteMindsApiKey).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });
});

// Boot routing is held across this call, and `resolveBootTarget` reads
// `config_ready` before it ever reaches `awaitBootReady()` — so whatever this
// decides is what the launch routes on. Nothing about it is visible at runtime:
// a push that silently stops happening looks exactly like a signed-out app.
describe('establishMindsCredential (boot)', () => {
  it('hands over a key the user supplied even with no Keycloak session', async () => {
    // The regression this exists to stop. Gating the boot push on a refresh
    // token left a BYOK install unconfigured after every restart: the key is in
    // the keychain and there is no session at all.
    (getRefreshToken as Mock).mockReturnValue(null);
    (getAccessToken as Mock).mockReturnValue(null);
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    const calls = installFetch();

    expect(await establishMindsCredential(vi.fn())).toBe(true);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'mdb_users_own' });
  });

  it('refreshes a stale session token before handing it over', async () => {
    // The in-memory token is process-lifetime only, so after a sleep past its
    // expiry the value on hand is one the gateway would refuse.
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    const refresh = vi.fn(async () => { (getAccessToken as Mock).mockReturnValue('fresh-token'); });
    const calls = installFetch();

    await establishMindsCredential(refresh);

    expect(refresh).toHaveBeenCalled();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'fresh-token' });
  });

  it('does not refresh when the cached token is still good', async () => {
    const refresh = vi.fn();
    installFetch();
    await establishMindsCredential(refresh);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pushes nothing when there is no credential to hand over', async () => {
    // Signed out with no key stored. Pushing a blank here would only clear what
    // the sidecar already lacks, and it would report a failed boot push.
    (getRefreshToken as Mock).mockReturnValue(null);
    (getAccessToken as Mock).mockReturnValue(null);
    const calls = installFetch();

    expect(await establishMindsCredential(vi.fn())).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a sidecar that would not take the credential', async () => {
    // Boot routing reads this: a false here means config_ready is still false
    // and the launch is about to route to onboarding.
    installFetch(500);
    expect(await establishMindsCredential(vi.fn())).toBe(false);
  });
});
