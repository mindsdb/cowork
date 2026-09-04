import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginSignOutRouting,
  endSignOutRouting,
  isSignOutRoutingActive,
  performSignOutCleanup,
  type SignOutDeps,
} from './sign-out';
import {
  awaitSignOutSidecarFlush,
  isSignOutFlushPending,
  startSignOutSidecarFlush,
} from './sign-out-restart';

/*
 * Sign-out used to await the sidecar restart, so the AUTH_LOGOUT
 * reply could not arrive for as long as a restart takes (up to the 180s start
 * cap, or longer behind the lifecycle queue) and the confirm dialog sat locked
 * on "Signing out…" the whole time. These tests are what that ordering never
 * had: the handler had no coverage at all while it lived in index.ts, which
 * imports Electron and cannot load under vitest.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function makeDeps(overrides: Partial<SignOutDeps> = {}): SignOutDeps {
  return {
    getRevokeToken: vi.fn(async () => 'access-token'),
    getRefreshToken: vi.fn(() => 'refresh-token'),
    revokeDeviceKeyAndEndSession: vi.fn(async () => {}),
    cancelScheduledRefresh: vi.fn(),
    cancelCurrentOAuth: vi.fn(),
    clearTokens: vi.fn(),
    settleMindsResumeCredentialGate: vi.fn(),
    resetMindsResumeCredentialGate: vi.fn(),
    forgetMindsCredential: vi.fn(async () => {}),
    isServerRunning: () => true,
    isServerStarting: () => false,
    getServerPort: () => 26866,
    httpRequest: vi.fn(async () => ({ status: 200, body: '{}' })),
    scrubEnvCredentials: vi.fn(async () => {}),
    getAntonEnvPath: () => '/home/user/.cowork/.env',
    clearStoredProviderState: vi.fn(),
    startSidecarFlush: vi.fn(),
    reloadRenderer: vi.fn(),
    ...overrides,
  };
}

afterEach(async () => {
  endSignOutRouting();
  // Leave no flush in flight for the next test to trip over.
  if (isSignOutFlushPending()) await awaitSignOutSidecarFlush(1_000);
});

describe('performSignOutCleanup', () => {
  /*
   * The regression test for the trap. Before this change the restart was two
   * awaits inside this sequence, so this promise could not resolve until the
   * sidecar was back up.
   */
  it('does not wait on the sidecar restart', async () => {
    const restartStarted = vi.fn();
    const deps = makeDeps({ startSidecarFlush: restartStarted });

    await performSignOutCleanup(deps);

    expect(restartStarted).toHaveBeenCalledTimes(1);
    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
  });

  /*
   * The same claim against the real restart module rather than a stub, wired
   * the way index.ts wires it. `startServer` never resolves here, standing in
   * for a start that runs to its 180 second cap: the sequence still replies
   * and still reloads, which is exactly what it could not do before.
   */
  it('replies and reloads while a sidecar start that never finishes is still running', async () => {
    const start = deferred<void>();
    const startServer = vi.fn(() => start.promise);
    const deps = makeDeps({
      /*
       * Hands back the pending flush rather than discarding it, so an `await`
       * reintroduced on this call would hang the sequence and fail this test.
       * That await is the defect.
       */
      startSidecarFlush: () => startSignOutSidecarFlush({
        isServerRunning: () => true,
        isServerStarting: () => false,
        stopServer: async () => {},
        startServer,
        probeConfigReady: async () => false,
      }),
    });

    await performSignOutCleanup(deps);

    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
    expect(isSignOutFlushPending()).toBe(true);
    expect(await awaitSignOutSidecarFlush(10)).toBe('timeout');

    start.resolve();
    await awaitSignOutSidecarFlush(1_000);
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('clears every credential store before it replies', async () => {
    const deps = makeDeps();

    await performSignOutCleanup(deps);

    // The three that actually sign the user out: the OS credential, the local
    // tokens, and the sidecar's own rows.
    expect(deps.forgetMindsCredential).toHaveBeenCalledTimes(1);
    expect(deps.clearTokens).toHaveBeenCalledTimes(1);
    expect(deps.httpRequest).toHaveBeenCalledWith(
      'http://127.0.0.1:26866/api/v1/settings/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  /*
   * Boot routing falls back to the .env when it cannot reach the sidecar, so a
   * reload that overtook the scrub could read a leftover key and route a
   * signed-out user back into the app.
   */
  it('scrubs the .env and clears provider state before the reload', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      scrubEnvCredentials: vi.fn(async () => { order.push('scrub'); }),
      clearStoredProviderState: vi.fn(() => { order.push('provider-state'); }),
      startSidecarFlush: vi.fn(() => { order.push('flush'); }),
      reloadRenderer: vi.fn(() => { order.push('reload'); }),
    });

    await performSignOutCleanup(deps);

    expect(order).toEqual(['scrub', 'provider-state', 'flush', 'reload']);
  });

  it('reads the refresh token only after the revoke exchange settles', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      getRevokeToken: vi.fn(async () => { order.push('revoke-token'); return 'access-token'; }),
      getRefreshToken: vi.fn(() => { order.push('refresh-token'); return 'refresh-token'; }),
    });

    await performSignOutCleanup(deps);

    // getRevokeToken can rotate the persisted refresh token, so reading it
    // earlier would hand end-session a superseded one.
    expect(order).toEqual(['revoke-token', 'refresh-token']);
  });

  it('does not wait on the detached Keycloak revoke', async () => {
    const revoke = deferred<void>();
    const deps = makeDeps({ revokeDeviceKeyAndEndSession: vi.fn(() => revoke.promise) });

    await performSignOutCleanup(deps);

    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
    revoke.resolve();
  });

  /*
   * keychain-fallback's write is unguarded, so on a machine with no OS secure
   * store this throws. An unguarded throw here would skip the token clear, the
   * DB clear, the .env scrub and the reload, which is the original wedge.
   */
  it('finishes the sequence when clearing the OS credential throws', async () => {
    const deps = makeDeps({
      forgetMindsCredential: vi.fn(async () => { throw new Error('no secure store'); }),
    });

    await expect(performSignOutCleanup(deps)).resolves.toBeUndefined();
    expect(deps.clearTokens).toHaveBeenCalledTimes(1);
    expect(deps.scrubEnvCredentials).toHaveBeenCalledTimes(1);
    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
  });

  it('finishes the sequence when the .env scrub cannot write', async () => {
    const deps = makeDeps({
      scrubEnvCredentials: vi.fn(async () => { throw new Error('EPERM'); }),
    });

    await expect(performSignOutCleanup(deps)).resolves.toBeUndefined();
    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
  });

  it('falls back to per-key deletes when the logout endpoint is missing', async () => {
    const httpRequest: SignOutDeps['httpRequest'] = vi.fn(async (url) => (
      url.endsWith('/settings/logout') ? { status: 404, body: '' } : { status: 200, body: '' }
    ));
    const deps = makeDeps({ httpRequest });

    await performSignOutCleanup(deps);

    const deleted = vi.mocked(httpRequest).mock.calls
      .filter(([, options]) => options.method === 'DELETE')
      .map(([url]) => url);
    expect(deleted).toContain('http://127.0.0.1:26866/api/v1/settings/minds_api_key');
    expect(deleted).toContain('http://127.0.0.1:26866/api/v1/settings/providers_json');
  });

  /*
   * The DB clear is raced against a 5s timeout, so a wedged sidecar rejects
   * here. It must not stop the rest: the tokens are already gone and the .env
   * scrub and the reload still have to happen.
   */
  it('presses on when the sidecar never answers the DB clear', async () => {
    const deps = makeDeps({
      httpRequest: vi.fn(async () => { throw new Error('socket hang up'); }),
    });

    await expect(performSignOutCleanup(deps)).resolves.toBeUndefined();
    expect(deps.scrubEnvCredentials).toHaveBeenCalledTimes(1);
    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
  });

  it('skips the sidecar rows when no sidecar is up to hold them', async () => {
    const deps = makeDeps({ isServerRunning: () => false, isServerStarting: () => false });

    await performSignOutCleanup(deps);

    expect(deps.httpRequest).not.toHaveBeenCalled();
    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
  });
});

/*
 * The latch exists because the reply now runs ahead of the restart. The
 * reloaded page can reach a sidecar that has not gone down yet and hear
 * config_ready: true from it, which would route the person who just signed out
 * back into the app.
 */
describe('sign-out routing latch', () => {
  beforeEach(() => {
    endSignOutRouting();
  });

  it('is off at rest', () => {
    expect(isSignOutRoutingActive()).toBe(false);
  });

  it('answers active from the moment sign-out begins until it is released', () => {
    beginSignOutRouting();
    expect(isSignOutRoutingActive()).toBe(true);

    endSignOutRouting();
    expect(isSignOutRoutingActive()).toBe(false);
  });

  it('stays active across the whole cleanup, including the reload', async () => {
    const seen: boolean[] = [];
    const deps = makeDeps({
      clearTokens: vi.fn(() => { seen.push(isSignOutRoutingActive()); }),
      reloadRenderer: vi.fn(() => { seen.push(isSignOutRoutingActive()); }),
    });

    beginSignOutRouting();
    await performSignOutCleanup(deps);

    expect(seen).toEqual([true, true]);
  });
});
