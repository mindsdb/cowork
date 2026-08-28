import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock('./token-store', () => ({
  getAccessToken: vi.fn(),
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

import { getAccessToken } from './token-store';
import { getServerPort, isServerRunning, isServerStarting } from './server-process';
import { getMindsApiKey, setMindsApiKey, deleteMindsApiKey } from './keychain-service';
import {
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
