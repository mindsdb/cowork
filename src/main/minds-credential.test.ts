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
  beginMindsResumeCredentialGate,
  isMindsResumeCredentialGateActive,
  settleMindsResumeCredentialGate,
  waitForMindsResumeCredential,
} from './minds-resume-gate';
import {
  establishMindsCredential,
  resolveMindsCredential,
  hasUserSuppliedMindsCredential,
  pushMindsCredential,
  syncMindsCredential,
  syncMindsCredentialSelection,
  syncUsableMindsCredential,
  setUserSuppliedMindsKey,
  clearUserSuppliedMindsKey,
  forgetMindsCredential,
  isMindsCredentialSidecarReachable,
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
  settleMindsResumeCredentialGate(true);
  vi.clearAllMocks();
  (getAccessToken as Mock).mockReturnValue('session-token');
  (getMindsApiKey as Mock).mockResolvedValue(null);
  (isServerRunning as Mock).mockReturnValue(true);
  (isServerStarting as Mock).mockReturnValue(false);
  (getServerPort as Mock).mockReturnValue(8765);
  (getRefreshToken as Mock).mockReturnValue('a-refresh-token');
  (isAccessTokenExpired as Mock).mockReturnValue(false);
});

describe('isMindsCredentialSidecarReachable', () => {
  // Distinguish an absent sidecar from a refused handoff even though pushMindsCredentialNow returns
  // false for both.
  it('is true while the sidecar runs', () => {
    (isServerRunning as Mock).mockReturnValue(true);
    (isServerStarting as Mock).mockReturnValue(false);
    expect(isMindsCredentialSidecarReachable()).toBe(true);
  });

  it('is true while the sidecar is still starting', () => {
    (isServerRunning as Mock).mockReturnValue(false);
    (isServerStarting as Mock).mockReturnValue(true);
    expect(isMindsCredentialSidecarReachable()).toBe(true);
  });

  it('is false at boot, before any sidecar exists', () => {
    (isServerRunning as Mock).mockReturnValue(false);
    (isServerStarting as Mock).mockReturnValue(false);
    expect(isMindsCredentialSidecarReachable()).toBe(false);
  });
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

  it('identifies a user-supplied key as independent of the Keycloak session', async () => {
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    await expect(hasUserSuppliedMindsCredential()).resolves.toBe(true);
  });

  it('does not call the session JWT user-supplied', async () => {
    await expect(hasUserSuppliedMindsCredential()).resolves.toBe(false);
  });
});

describe('pushMindsCredential', () => {
  it('PUTs the value to the sidecar carrying the server bearer token', async () => {
    // Main-process fetch bypasses renderer auth injection; the PUT must supply authHeader under
    // COWORK_REQUIRE_AUTH.
    const calls = installFetch();
    expect(await pushMindsCredential('a-token')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('http://127.0.0.1:8765/api/v1/runtime-credential/minds');
    expect(calls[0].auth).toBe('Bearer owner-token');
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'a-token' });
  });

  it('does not release a resume gate merely because a generic stale-token push landed', async () => {
    beginMindsResumeCredentialGate();
    installFetch();

    expect(await pushMindsCredential('expired-session-token')).toBe(true);
    expect(isMindsResumeCredentialGateActive()).toBe(true);

    let released = false;
    const waiting = waitForMindsResumeCredential().then((ready) => {
      released = true;
      return ready;
    });
    await Promise.resolve();
    expect(released).toBe(false);

    settleMindsResumeCredentialGate(true);
    await expect(waiting).resolves.toBe(true);
  });

  it('serializes handovers so an older PUT cannot finish after a newer value', async () => {
    const calls: string[] = [];
    const releases: Array<() => void> = [];
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)).value);
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return { ok: true, status: 204 };
    }) as unknown as typeof fetch;

    const oldPush = pushMindsCredential('expired-session-token');
    await Promise.resolve();
    expect(calls).toEqual(['expired-session-token']);

    const freshPush = pushMindsCredential('fresh-session-token');
    await Promise.resolve();
    expect(calls).toEqual(['expired-session-token']);

    releases[0]();
    await expect(oldPush).resolves.toBe(true);
    await Promise.resolve();
    expect(calls).toEqual(['expired-session-token', 'fresh-session-token']);

    releases[1]();
    await expect(freshPush).resolves.toBe(true);
  });

  it('queues selection before an async keychain read can invert sync order', async () => {
    let releaseOldSelection!: (value: string | null) => void;
    (getMindsApiKey as Mock)
      .mockReturnValueOnce(new Promise<string | null>((resolve) => {
        releaseOldSelection = resolve;
      }))
      .mockResolvedValueOnce(null);
    const calls = installFetch();

    const oldSync = syncMindsCredentialSelection();
    await Promise.resolve();
    const freshSync = syncMindsCredentialSelection();
    (getAccessToken as Mock).mockReturnValue('fresh-session-token');

    releaseOldSelection('mdb_old_selection');
    await expect(oldSync).resolves.toEqual({ landed: true, usable: true });
    await expect(freshSync).resolves.toEqual({ landed: true, usable: true });

    expect(calls.map((call) => JSON.parse(call.body as string).value)).toEqual([
      'mdb_old_selection',
      'fresh-session-token',
    ]);
  });

  it('keeps the handoff queue usable after an unexpected selection rejection', async () => {
    (getAccessToken as Mock)
      .mockImplementationOnce(() => { throw new Error('token store unavailable'); })
      .mockReturnValue('session-token');
    const calls = installFetch();

    await expect(syncMindsCredentialSelection()).rejects.toThrow('token store unavailable');
    await expect(syncMindsCredentialSelection()).resolves.toEqual({ landed: true, usable: true });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'session-token' });
  });

  it('sends a blank value to clear, never the literal null', async () => {
    const calls = installFetch();
    await pushMindsCredential(null);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });

  it('does not call a sidecar that reports running with no port yet', async () => {
    // Running flags can precede port resolution; do not send a credential handoff to loopback port
    // 0.
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

  it('names an older sidecar as the cause when the route is not there', async () => {
    // App and sidecar update independently; an older sidecar's missing handoff route must not look
    // like provider misconfiguration.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFetch(404);

    expect(await pushMindsCredential('a-token')).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('predates this build');

    warn.mockRestore();
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
    // Refresh and invalid-grant callers do not await this operation; rejection must not escape as
    // an unhandled promise.
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

describe('syncUsableMindsCredential', () => {
  it('reports a user-supplied key as usable after handing it over', async () => {
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    installFetch();
    await expect(syncUsableMindsCredential()).resolves.toBe(true);
  });

  it('clears the sidecar but reports false when no credential is selected', async () => {
    (getAccessToken as Mock).mockReturnValue(null);
    const calls = installFetch();

    await expect(syncUsableMindsCredential()).resolves.toBe(false);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });

  it('does not call an expired session JWT usable merely because it landed', async () => {
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    installFetch();

    await expect(syncUsableMindsCredential()).resolves.toBe(false);
  });

  // Hold usable=true while landed=false to discriminate the landed half of the resume guard.
  it('does not call a usable credential ready when the sidecar refuses it', async () => {
    (getAccessToken as Mock).mockReturnValue('fresh-session-token');
    (isAccessTokenExpired as Mock).mockReturnValue(false);
    (getMindsApiKey as Mock).mockResolvedValue(null);
    installFetch(500);

    await expect(syncUsableMindsCredential()).resolves.toBe(false);
  });
});

describe('a user-supplied key', () => {
  it('is stored in the keychain and handed over immediately', async () => {
    beginMindsResumeCredentialGate();
    const calls = installFetch();
    expect(await setUserSuppliedMindsKey('mdb_pasted')).toBe(true);
    expect(setMindsApiKey).toHaveBeenCalledWith('mdb_pasted');
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'mdb_pasted' });
    expect(isMindsResumeCredentialGateActive()).toBe(false);
  });

  it('does not release the resume gate when the sidecar refuses the new key', async () => {
    beginMindsResumeCredentialGate();
    installFetch(500);

    await expect(setUserSuppliedMindsKey('mdb_pasted')).resolves.toBe(false);
    expect(isMindsResumeCredentialGateActive()).toBe(true);
  });

  it('falls back to the session credential when removed', async () => {
    // Without the push, the sidecar would keep running on the key the user just
    // removed until something else happened to push.
    const calls = installFetch();
    await clearUserSuppliedMindsKey();
    expect(deleteMindsApiKey).toHaveBeenCalled();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: 'session-token' });
  });

  it('does not release the resume gate onto an expired fallback session', async () => {
    beginMindsResumeCredentialGate();
    (isAccessTokenExpired as Mock).mockReturnValue(true);
    installFetch();

    await expect(clearUserSuppliedMindsKey()).resolves.toBe(true);
    expect(isMindsResumeCredentialGateActive()).toBe(true);
  });

  it('does not release the resume gate when the fallback handoff is refused', async () => {
    beginMindsResumeCredentialGate();
    installFetch(500);

    await expect(clearUserSuppliedMindsKey()).resolves.toBe(false);
    expect(isMindsResumeCredentialGateActive()).toBe(true);
  });
});

describe('forgetMindsCredential (sign-out)', () => {
  it('still clears the sidecar when the keychain delete throws', async () => {
    // A fallback-keychain write can throw; still execute the step that stops this install's turns.
    (deleteMindsApiKey as Mock).mockRejectedValue(new Error('no secret service'));
    const calls = installFetch();

    await expect(forgetMindsCredential()).resolves.toBeUndefined();
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });

  it('clears the keychain AND the sidecar, not one or the other', async () => {
    // Clearing only the sidecar would let the next startup restore the keychain credential after
    // sign-out.
    (getMindsApiKey as Mock).mockResolvedValue('mdb_users_own');
    const calls = installFetch();
    await forgetMindsCredential();
    expect(deleteMindsApiKey).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body as string)).toEqual({ value: '' });
  });
});

// Boot reads config_ready before awaitBootReady; credential push determines its initial routing.
describe('establishMindsCredential (boot)', () => {
  it('hands over a key the user supplied even with no Keycloak session', async () => {
    // A BYOK install can have a keychain key without any refresh token; boot must still push that
    // key.
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
