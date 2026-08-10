// Orchestration tests for the sidecar start path. The budget decision itself
// is tested directly in update-logic.test.ts; what's covered here is the wiring
// the decision depends on — that a spawn failure and an early exit actually
// reach the diagnostics, that a timed-out start reaps the whole process tree on
// Windows, and that the port-holder lookup survives a non-English Windows.
//
// server-process pulls in electron; fs/child_process/http are mocked so nothing
// spawns a real process or touches the network. process.kill is stubbed for the
// same reason: killTree's POSIX branch signals a process GROUP, and the fake
// child's pid is not ours to signal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp/cowork-test-logs' },
}));
vi.mock('./cowork-home', () => ({
  coworkHome: () => '/tmp/cowork-test-home',
  buildKind: () => 'prod',
}));
vi.mock('./minds-urls', () => ({ MINDS_ENV_SLUG: '' }));
vi.mock('./uv-paths', () => ({
  getEnvPath: () => '/usr/bin',
  findUv: () => '/usr/bin/uv',
  coworkServerBinCandidates: () => ['/fake/bin/cowork-server'],
}));
vi.mock('fs');
vi.mock('child_process');
vi.mock('http');

import { startServer, getServerDiagnostics, isServerRunning, stopServer } from './server-process';

const PORT = 27903;

/** A stand-in for the spawned sidecar. Nothing is emitted until a test says
 *  so, so each test drives its own failure mode. */
function makeChild(): EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; exitCode: number | null; killed: boolean; kill: (s?: unknown) => boolean } {
  const child = new EventEmitter() as ReturnType<typeof makeChild>;
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
}

/** A stand-in for the on-disk log WriteStream. An EventEmitter so the code
 *  under test can attach the 'error' listener that ENG-1187 turns on. */
function makeLogStream(): EventEmitter & { write: () => boolean; end: () => void } {
  const s = new EventEmitter() as ReturnType<typeof makeLogStream>;
  s.write = () => true;
  s.end = () => {};
  return s;
}

/** Owner token /health answers with, or null to make every probe fail. */
let healthOwner: string | null = null;

/** Records every execFile call and lets a test decide what each one returns. */
let execCalls: Array<{ cmd: string; args: string[] }> = [];
let execHandler: (cmd: string, args: string[]) => { err: Error | null; stdout: string };

const originalPlatform = process.platform;
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

/** Signals killTree's POSIX branch sent, as [pid, signal]. A negative pid is a
 *  process-group kill, which is the behaviour these tests care about. */
let signals: Array<[number, string]> = [];

beforeEach(() => {
  execCalls = [];
  execHandler = () => ({ err: new Error('nothing found'), stdout: '' });

  // process.kill is the real global — killTree calls it directly, so without
  // this stub the POSIX branch would SIGTERM and then SIGKILL whatever process
  // group happens to own the fake child's pid on the machine running the
  // tests. Reporting success (rather than throwing) also keeps the code on the
  // group-kill path instead of falling through to child.kill().
  signals = [];
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string) => {
    signals.push([pid, String(signal)]);
    return true;
  }) as never);

  // The packaged binary exists; no dev source tree does.
  vi.mocked(fs.existsSync).mockImplementation((p) => String(p) === '/fake/bin/cowork-server');
  vi.mocked(fs.readFileSync).mockReturnValue('owner-token\n' as never);
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined as never);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fs.chmodSync).mockReturnValue(undefined);
  vi.mocked(fs.createWriteStream).mockImplementation((() => {
    return makeLogStream() as never;
  }) as never);

  vi.mocked(cp.execFile).mockImplementation(((cmd: string, args: string[], _opts: unknown, cb: unknown) => {
    execCalls.push({ cmd, args });
    const { err, stdout } = execHandler(cmd, args);
    if (typeof cb === 'function') setTimeout(() => (cb as (e: Error | null, o: string, s: string) => void)(err, stdout, ''), 0);
    return {} as never;
  }) as never);

  // Health probes fail by default: most of these tests are about failed
  // starts. A test opts into a healthy backend by flipping `healthOwner`.
  healthOwner = null;
  vi.mocked(http.get).mockImplementation(((_opts: unknown, cb: unknown) => {
    const owner = healthOwner;
    if (owner !== null && typeof cb === 'function') {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
      res.statusCode = 200;
      res.resume = () => {};
      setTimeout(() => {
        (cb as (r: unknown) => void)(res);
        res.emit('data', JSON.stringify({ owner }));
        res.emit('end');
      }, 0);
    }
    const req = {
      on: (event: string, handler: () => void) => {
        if (event === 'error' && owner === null) setTimeout(handler, 0);
        return req;
      },
      destroy: () => {},
    };
    return req as never;
  }) as never);
});

afterEach(() => {
  setPlatform(originalPlatform);
  vi.clearAllMocks();
});

describe('startServer failure diagnostics', () => {
  it('reports a spawn error instead of a health timeout, and keeps it in the log tail', async () => {
    // Regression: the spawn had no 'error' listener, so an AV-blocked or
    // missing executable was reported as "no /health within 15000ms" with an
    // empty log — the user was told to wait for something that never ran.
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => child.emit('error', new Error('spawn EPERM')), 0);
      return child as never;
    }) as never);

    const result = await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    const diag = getServerDiagnostics();
    expect(diag.lastError).toBe('The backend could not be launched: spawn EPERM.');
    expect(diag.lastErrorKind).toBe('spawn-error');
    expect(diag.recentLog).toContain('spawn EPERM');
  });

  it('survives an EPERM on the log file instead of crashing the main process', async () => {
    // Regression (ENG-1187): createWriteStream reports an open failure via an
    // async 'error' event, not a throw — so the try/catch around it never saw
    // it. With no 'error' listener Node re-raised it as an uncaught exception,
    // which Electron turned into a fatal "A JavaScript error occurred in the
    // main process" dialog that blocked startup on Windows. Disk logging is
    // best-effort: the open failure must be swallowed and the app must start.
    vi.mocked(fs.createWriteStream).mockImplementation((() => {
      const s = makeLogStream();
      // Fire the failure the moment the caller has had a chance to listen —
      // if nothing listened this emit would throw synchronously and fail the
      // test, which is exactly the crash this guards against.
      setTimeout(() => s.emit('error', new Error('EPERM: operation not permitted, open')), 0);
      return s as never;
    }) as never);

    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      // Health is the authority; the launcher exiting lets stopServer() below
      // resolve without a real reap (see the healthy-backend test).
      setTimeout(() => { healthOwner = 'owner-token'; child.exitCode = 0; child.emit('exit', 0); }, 0);
      return child as never;
    }) as never);

    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(true);
    expect(isServerRunning()).toBe(true);
    await stopServer(); // leave the module's state clean for the next test
  });

  it('fails as soon as the child dies rather than waiting out the budget', async () => {
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { child.exitCode = 1; child.emit('exit', 1); }, 0);
      return child as never;
    }) as never);

    const startedAt = Date.now();
    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    const diag = getServerDiagnostics();
    expect(diag.lastErrorKind).toBe('exited');
    expect(diag.lastError).toContain('code 1');
  });

  it('counts a healthy backend as started even when the launcher we spawned has exited', async () => {
    // On Windows the thing we spawn can hand off to a python child and exit.
    // Health is the authority: the server is up, so this is a start, not a
    // death — and it has to keep reading as running afterwards.
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => {
        healthOwner = 'owner-token';
        child.exitCode = 0;
        child.emit('exit', 0);
      }, 0);
      return child as never;
    }) as never);

    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(true);
    expect(isServerRunning()).toBe(true);
    expect(getServerDiagnostics().lastError).toBeNull();
    await stopServer(); // leave the module's state clean for the next test
  });

  it('says the backend was still starting when the cap runs out on a live child', async () => {
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => child as never) as never);

    // Cap of 0 expires on the first check, with the child alive and silent.
    const result = await startServer({ port: PORT, readyTimeoutMs: 0 });

    expect(result.ok).toBe(false);
    const diag = getServerDiagnostics();
    expect(diag.lastErrorKind).toBe('timeout');
    expect(diag.lastError).toContain('still starting');
    // A live child gets reaped by process GROUP, not by pid: the packaged
    // binary can have a python of its own, and killing only the leader is
    // what left an orphan holding the port.
    expect(signals).toContainEqual([-4242, 'SIGTERM']);
  });

  it('does not spend the reap timeout on an exit event that can never arrive', async () => {
    // A spawn that never happened emits 'error' and nothing else — Node does
    // not emit 'exit' for a process that never existed. Waiting on one cost
    // this path 2s, on the one failure whose point is that it reports at once.
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => child.emit('error', new Error('spawn ENOENT')), 0);
      return child as never;
    }) as never);

    const startedAt = Date.now();
    await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(signals).toEqual([]); // nothing to reap
  });
});

describe('Windows reap', () => {
  it('kills the whole tree with taskkill so no python survives a failed start', async () => {
    // proc.kill() reaches the launcher only; the python grandchild kept
    // importing and later bound the port behind the app's back.
    setPlatform('win32');
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => child as never) as never);
    execHandler = (cmd) => {
      if (cmd === 'taskkill') {
        setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 0);
        return { err: null, stdout: '' };
      }
      return { err: new Error('nothing found'), stdout: '' };
    };

    await startServer({ port: PORT, readyTimeoutMs: 0 });

    const taskkill = execCalls.find((c) => c.cmd === 'taskkill');
    expect(taskkill).toBeDefined();
    expect(taskkill?.args).toEqual(['/F', '/T', '/PID', '4242']);
    expect(child.killed).toBe(false); // the tree kill replaces it, not supplements it
  });

  // Matching the literal "LISTENING" made the reap a silent no-op outside
  // English installs.
  //
  // These cases are not an attempt to enumerate the locales Windows ships —
  // that list is unknowable from here and would rot. The parser never reads the
  // state column at all; it anchors on four things no locale translates: the
  // literal TCP protocol name, the local address ending in our port, the
  // all-zero foreign address, and the PID being the LAST column. So the only
  // things that can break it are the two axes below, and a new language is
  // covered the moment its state word matches one of these shapes:
  //
  //   - token count, because it shifts every column after it (this is what
  //     defeated a fixed `cols[4]` read even after the word stopped mattering)
  //   - script, because the row still has to survive splitting and comparison
  //
  // Real strings are used where known; the three-token row is synthetic, since
  // the point is that an unknown-length state cannot break the parse.
  const STATE_WORDS = [
    { shape: 'one ASCII word', state: 'LISTENING' },
    { shape: 'one accented word', state: 'ABHÖREN' },
    { shape: 'one Spanish word', state: 'ESCUCHANDO' },
    { shape: 'one Cyrillic word', state: 'ПРОСЛУШИВАНИЕ' },
    { shape: 'one CJK word', state: '接続待ち' },
    { shape: 'two words', state: 'IN ASCOLTO' },
    { shape: 'two words with an apostrophe', state: "À L'ÉCOUTE" },
    { shape: 'three words', state: 'EN ATTENTE DE' },
  ];

  it.each(STATE_WORDS)('finds the port holder when the state column is $shape', async ({ state }) => {
    setPlatform('win32');
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => child as never) as never);
    const netstat = [
      '',
      '  Proto  Local Address          Foreign Address        State            PID',
      `  TCP    127.0.0.1:${PORT}      0.0.0.0:0              ${state}          9911`,
      `  TCP    [::]:${PORT}           [::]:0                 ${state}          9911`,
      // Same local port, but a real peer: a connection to the server, not the
      // server. Must never be reaped.
      `  TCP    127.0.0.1:${PORT}      127.0.0.1:443          ${state}          777`,
      // UDP rows have no state column at all.
      `  UDP    127.0.0.1:${PORT}      *:*                                     123`,
    ].join('\r\n');
    execHandler = (cmd) => {
      if (cmd === 'netstat') return { err: null, stdout: netstat };
      if (cmd === 'taskkill') {
        setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 0);
        return { err: null, stdout: '' };
      }
      return { err: new Error('nothing found'), stdout: '' };
    };

    await startServer({ port: PORT, readyTimeoutMs: 0 });

    // Reaped before the spawn, and named as the port holder after the failure.
    const killed = execCalls.filter((c) => c.cmd === 'taskkill').flatMap((c) => c.args);
    expect(killed).toContain('9911');
    expect(killed).not.toContain('777');
    expect(killed).not.toContain('123');
    expect(getServerDiagnostics().portHolderPid).toBe(9911);
  });
});
