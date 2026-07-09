import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';

// Transaction-level race regression (the reviewer's ask on #381).
//
// server-updater.test.ts stubs withServerMaintenance to a pass-through, so it
// exercises the reinstall LOGIC but not the locking. This file instead wires
// the REAL lifecycle lock (./server-lifecycle) into the ./server-process mock,
// then proves the thing the Blocking finding was about: while
// repairServerInstall() is mid `uv tool install`, a concurrent startServer()
// must NOT spawn — it has to queue behind the whole transaction. That is what
// stops python from launching against a half-written venv.
const hooks = vi.hoisted(() => ({
  startSpawn: vi.fn(), // records that a start actually entered its spawn body
}));

vi.mock('./server-process', async () => {
  // The genuine re-entrant queue — not a pass-through.
  const { withServerLifecycle } = await vi.importActual<typeof import('./server-lifecycle')>('./server-lifecycle');
  return {
    withServerMaintenance: <T>(fn: () => Promise<T>) => withServerLifecycle(fn),
    // Mirror the real server-process: startServer/stopServer enter the same
    // lifecycle queue, so an external start serializes behind a maintenance
    // transaction (and a nested one inside a transaction runs immediately).
    startServer: (_opts?: unknown) =>
      withServerLifecycle(async () => {
        hooks.startSpawn();
        return { ok: true, port: 26866 };
      }),
    stopServer: () => withServerLifecycle(async () => {}),
    isServerRunning: () => false,
  };
});
vi.mock('fs');
vi.mock('child_process');

import { startServer } from './server-process';
import { repairServerInstall } from './server-updater';

const BROKEN = "ImportError: cannot import name 'Doc' from 'annotated_doc' (unknown location)";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.UV_TOOL_DIR;
  delete process.env.COWORK_SERVER_DISABLE_AUTOUPDATE;
});

/** Flush pending microtasks/timers so any work that COULD run gets the chance
 *  — the assertion that a start stayed queued is only meaningful after this. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('repairServerInstall — concurrent-start serialization', () => {
  it('holds the lifecycle lock across the whole reinstall so a racing startServer cannot spawn mid-install', async () => {
    process.env.UV_TOOL_DIR = '/fake/uv/tools';
    vi.mocked(fs.existsSync).mockReturnValue(true); // uv binary + site-packages present
    vi.mocked(fs.readdirSync).mockReturnValue([] as never); // no vcs_info → PyPI reinstall path

    // Make the `uv tool install` (the venv-rewrite) controllable: capture its
    // callback and only fire it when we choose, so we can observe the window
    // while the venv is "half-written".
    let releaseInstall!: () => void;
    let installReached!: () => void;
    const installInFlight = new Promise<void>((resolve) => { installReached = resolve; });

    vi.mocked(cp.execFile).mockImplementation(((
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args[0] === 'tool' && args[1] === 'dir') {
        cb(null, '/fake/uv/tools\n', ''); // uv tool dir — resolves immediately
      } else if (args.includes('install')) {
        installReached();                  // signal the reinstall has begun
        releaseInstall = () => cb(null, '', ''); // …but don't finish it yet
      } else {
        cb(null, '', '');
      }
      return {} as never;
    }) as never);

    // Kick off the repair (holds the lock) and let it reach the blocked install.
    let repairResult: boolean | undefined;
    const repair = repairServerInstall(BROKEN).then((r) => { repairResult = r; });
    await installInFlight;

    // Now, mid-reinstall, a concurrent start arrives (e.g. a post-onboarding
    // restart). It must queue behind the transaction, not spawn.
    let startResolved = false;
    const start = startServer().then(() => { startResolved = true; });

    await settle();
    // The reinstall is still in flight; the racing start has NOT spawned.
    expect(repairResult).toBeUndefined();
    expect(startResolved).toBe(false);
    expect(hooks.startSpawn).not.toHaveBeenCalled();

    // Finish the reinstall → the transaction completes and releases the lock.
    releaseInstall();
    await Promise.all([repair, start]);

    // Repair succeeded, and only THEN did the start spawn — serialized, so
    // python never launched against the half-written venv.
    expect(repairResult).toBe(true);
    expect(startResolved).toBe(true);
    expect(hooks.startSpawn).toHaveBeenCalledTimes(1);
  });
});
