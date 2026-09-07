import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  awaitSignOutSidecarFlush,
  isSignOutFlushPending,
  startSignOutSidecarFlush,
  type SignOutFlushDeps,
} from './sign-out-restart';

/*
 * The flush runs without anyone awaiting it, which is the whole point of the
 * fix — and also why the two contracts below matter more than usual: an
 * unhandled rejection in the main process is a crash, and two overlapping
 * restarts would fight over one sidecar process.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeDeps(overrides: Partial<SignOutFlushDeps> = {}): SignOutFlushDeps {
  return {
    isServerRunning: () => true,
    isServerStarting: () => false,
    stopServer: vi.fn(async () => {}),
    startServer: vi.fn(async () => {}),
    probeConfigReady: vi.fn(async () => false),
    ...overrides,
  };
}

// Each test starts with no flush in flight; the module clears its own slot on
// settle, so draining a pending one is enough.
beforeEach(async () => {
  if (isSignOutFlushPending()) await awaitSignOutSidecarFlush(1_000);
});

describe('startSignOutSidecarFlush', () => {
  it('reports nothing to flush when no sidecar is running or starting', async () => {
    const deps = makeDeps({ isServerRunning: () => false, isServerStarting: () => false });

    const outcome = await startSignOutSidecarFlush(deps);

    expect(outcome).toEqual({
      attempted: false, restarted: false, configReadyAfter: null, failure: null,
    });
    expect(deps.stopServer).not.toHaveBeenCalled();
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it('flushes a sidecar that is still only starting', async () => {
    const deps = makeDeps({ isServerRunning: () => false, isServerStarting: () => true });

    const outcome = await startSignOutSidecarFlush(deps);

    expect(outcome.attempted).toBe(true);
    expect(deps.stopServer).toHaveBeenCalledTimes(1);
    expect(deps.startServer).toHaveBeenCalledTimes(1);
  });

  it('stops before it starts, and reports config_ready afterwards', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      stopServer: vi.fn(async () => { calls.push('stop'); }),
      startServer: vi.fn(async () => { calls.push('start'); }),
      probeConfigReady: vi.fn(async () => { calls.push('probe'); return false; }),
    });

    const outcome = await startSignOutSidecarFlush(deps);

    expect(calls).toEqual(['stop', 'start', 'probe']);
    expect(outcome).toEqual({
      attempted: true, restarted: true, configReadyAfter: false, failure: null,
    });
  });

  it('joins the flush already running instead of starting a second one', async () => {
    const start = deferred<void>();
    const deps = makeDeps({ startServer: vi.fn(() => start.promise) });

    const first = startSignOutSidecarFlush(deps);
    const second = startSignOutSidecarFlush(deps);

    expect(second).toBe(first);
    start.resolve();
    await first;
    expect(deps.stopServer).toHaveBeenCalledTimes(1);
    expect(deps.startServer).toHaveBeenCalledTimes(1);
  });

  it('reports a restart failure rather than rejecting', async () => {
    const deps = makeDeps({ stopServer: vi.fn(async () => { throw new Error('port held'); }) });

    const outcome = await startSignOutSidecarFlush(deps);

    expect(outcome.restarted).toBe(false);
    expect(outcome.failure).toContain('port held');
    expect(deps.startServer).not.toHaveBeenCalled();
  });

  it('treats a failed config_ready probe as a restart that still happened', async () => {
    const deps = makeDeps({
      probeConfigReady: vi.fn(async () => { throw new Error('health check timed out'); }),
    });

    const outcome = await startSignOutSidecarFlush(deps);

    expect(outcome).toEqual({
      attempted: true, restarted: true, configReadyAfter: null, failure: null,
    });
  });

  /*
   * The restart exists to make config_ready false. A true here means the DB
   * clear did not take and credentials survived it, which is the one outcome
   * worth shouting about rather than logging quietly.
   */
  it('reports config_ready still being true after the restart', async () => {
    const deps = makeDeps({ probeConfigReady: vi.fn(async () => true) });
    const shouted = vi.spyOn(console, 'error').mockImplementation(() => {});

    const outcome = await startSignOutSidecarFlush(deps);

    expect(outcome.configReadyAfter).toBe(true);
    expect(shouted).toHaveBeenCalledWith(expect.stringContaining('credentials survived'));
    shouted.mockRestore();
  });

  it('accepts a new flush once the previous one has settled', async () => {
    const deps = makeDeps();

    await startSignOutSidecarFlush(deps);
    await startSignOutSidecarFlush(deps);

    expect(deps.stopServer).toHaveBeenCalledTimes(2);
  });
});

describe('awaitSignOutSidecarFlush', () => {
  it('answers idle when there is nothing pending', async () => {
    await expect(awaitSignOutSidecarFlush(50)).resolves.toBe('idle');
  });

  it('answers settled once the flush lands', async () => {
    const start = deferred<void>();
    void startSignOutSidecarFlush(makeDeps({ startServer: () => start.promise }));

    const waiting = awaitSignOutSidecarFlush(5_000);
    start.resolve();

    await expect(waiting).resolves.toBe('settled');
  });

  /*
   * A timeout is the caller saying it has waited long enough, not that the
   * restart should stop. Signing in presses on after it; the restart still
   * finishes and still queues on the same lifecycle tail.
   */
  it('answers timeout without cancelling the flush', async () => {
    const start = deferred<void>();
    const flush = startSignOutSidecarFlush(makeDeps({ startServer: () => start.promise }));

    await expect(awaitSignOutSidecarFlush(10)).resolves.toBe('timeout');
    expect(isSignOutFlushPending()).toBe(true);

    start.resolve();
    await expect(flush).resolves.toMatchObject({ restarted: true });
  });
});
