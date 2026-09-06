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
 * Logout must reply without waiting for sidecar restart, which can consume the full start cap or
 * queue behind maintenance.
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
  it('does not wait on the sidecar restart', async () => {
    const restartStarted = vi.fn();
    const deps = makeDeps({ startSidecarFlush: restartStarted });

    await performSignOutCleanup(deps);

    expect(restartStarted).toHaveBeenCalledTimes(1);
    expect(deps.reloadRenderer).toHaveBeenCalledTimes(1);
  });

  /*
   * Use the real restart module with a never-resolving start to prove logout still replies and
   * reloads.
   */
  it('replies and reloads while a sidecar start that never finishes is still running', async () => {
    const start = deferred<void>();
    const startServer = vi.fn(() => start.promise);
    const deps = makeDeps({
      /*
       * Return the pending flush so accidentally awaiting it would hang the sequence and fail this
       * test.
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
   * Scrub .env before reload; boot's offline fallback could otherwise route a signed-out user using
   * leftover keys.
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

  /* A fallback-keychain write failure must not skip token/DB clearing, env scrubbing or reload. */
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
   * After DB-clear timeout, credentials are already cleared locally; env scrubbing and reload must
   * continue.
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

/* Hold routing after logout reply: a sidecar not yet restarted can still report config_ready=true. */
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
