import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as cp from 'child_process';

// Use the real lifecycle lock; pass-through maintenance mocks in server-updater.test.ts cannot
// detect races.
// A concurrent start must wait for the entire venv rewrite before spawning Python.
const hooks = vi.hoisted(() => ({
  startSpawn: vi.fn(), // records that a start actually entered its spawn body
}));

vi.mock('./server-process', async () => {
  // The genuine re-entrant queue — not a pass-through.
  const { withServerLifecycle } = await vi.importActual<typeof import('./server-lifecycle')>('./server-lifecycle');
  return {
    withServerMaintenance: <T>(fn: () => Promise<T>) => withServerLifecycle(fn),
    // Route start/stop through the real lifecycle queue, including nested calls inside maintenance.
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

    // Hold uv's callback to observe the transaction while its venv rewrite is incomplete.
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

    let repairResult: boolean | undefined;
    const repair = repairServerInstall(BROKEN).then((r) => { repairResult = r; });
    await installInFlight;

    // Now, mid-reinstall, a concurrent start arrives (e.g. a post-onboarding
    // restart). It must queue behind the transaction, not spawn.
    let startResolved = false;
    const start = startServer().then(() => { startResolved = true; });

    await settle();
    expect(repairResult).toBeUndefined();
    expect(startResolved).toBe(false);
    expect(hooks.startSpawn).not.toHaveBeenCalled();

    releaseInstall();
    await Promise.all([repair, start]);

    // Repair succeeded, and only THEN did the start spawn — serialized, so
    // python never launched against the half-written venv.
    expect(repairResult).toBe(true);
    expect(startResolved).toBe(true);
    expect(hooks.startSpawn).toHaveBeenCalledTimes(1);
  });
});
