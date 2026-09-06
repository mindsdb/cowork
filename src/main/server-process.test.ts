// Test sidecar startup orchestration; update-logic.test.ts covers pure decisions.
// Mock processes, network and process.kill so fake pids cannot signal real process groups.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp/cowork-test-logs' },
}));
vi.mock('./cowork-home', () => ({
  coworkHome: () => '/tmp/cowork-test-home',
  buildKind: () => 'prod',
  readEnvFile: () => ({}),
}));
vi.mock('./minds-urls', () => ({ MINDS_ENV_SLUG: '' }));
/** What resolveUv reports; the dev-mode tests flip it per scenario. */
const uvState = vi.hoisted(() => ({ resolveUv: '/usr/bin/uv' as string | null }));
vi.mock('./uv-paths', () => ({
  getEnvPath: () => '/usr/bin',
  resolveUv: async () => uvState.resolveUv,
  coworkServerBinCandidates: () => ['/fake/bin/cowork-server'],
}));
// Mock credential provisioning to avoid importing native keytar; that layer has separate tests.
vi.mock('./credential-provisioning', () => ({
  loadBundledServerCredentials: vi.fn().mockResolvedValue({}),
}));
vi.mock('fs');
vi.mock('child_process');
vi.mock('http');
vi.mock('net');

import { app } from 'electron';
import {
  startServer,
  getServerDiagnostics,
  isServerRunning,
  resolveServerPort,
  stopServer,
  setServerStartedHook,
} from './server-process';

const PORT = 27903;
/** What the OS hands back when resolveServerPort asks for a free port. Outside
 *  the per-user band so a test can tell a relocation from the preferred port. */
const FREE_PORT = 41999;

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
/** Capabilities advertised by /health. Code Mode must not adopt a sidecar
 *  merely because it is healthy when the coding routes are absent. */
let healthCapabilities: string[] = ['coding'];

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
  uvState.resolveUv = '/usr/bin/uv';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

  // Stub global process.kill so fake pids cannot signal real process groups.
  // Return success to exercise the group-kill path rather than child.kill fallback.
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

  vi.mocked(net.createServer).mockImplementation((() => {
    const srv = {
      once: () => srv,
      listen: (_port: number, _host: string, cb: () => void) => { cb(); return srv; },
      address: () => ({ port: FREE_PORT }),
      close: (cb: () => void) => { cb(); return srv; },
    };
    return srv as never;
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
  healthCapabilities = ['coding'];
  vi.mocked(http.get).mockImplementation(((_opts: unknown, cb: unknown) => {
    const owner = healthOwner;
    if (owner !== null && typeof cb === 'function') {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void };
      res.statusCode = 200;
      res.resume = () => {};
      setTimeout(() => {
        (cb as (r: unknown) => void)(res);
        res.emit('data', JSON.stringify({ owner, capabilities: healthCapabilities }));
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('startServer failure diagnostics', () => {
  it('reports a spawn error instead of a health timeout, and keeps it in the log tail', async () => {
    // Spawn errors must identify executables that never ran instead of reporting a later health
    // timeout.
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
    // createWriteStream reports open failures through an error event, beyond the surrounding
    // try/catch. Logging is best effort; the event must not crash startup.
    vi.mocked(fs.createWriteStream).mockImplementation((() => {
      const s = makeLogStream();
      // Emit after listener registration; an unhandled error event throws and exposes the startup
      // crash.
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

  it('keeps the previous run\'s log as cowork-server.log.1 across a relaunch', async () => {
    const files = new Map<string, string>();
    vi.mocked(fs.createWriteStream).mockImplementation(((p: string) => {
      files.set(String(p), '');
      const s = makeLogStream();
      s.write = ((chunk: string) => { files.set(String(p), files.get(String(p)) + chunk); return true; }) as never;
      return s as never;
    }) as never);
    vi.mocked(fs.renameSync).mockImplementation(((from: string, to: string) => {
      if (!files.has(String(from))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      files.set(String(to), files.get(String(from))!);
      files.delete(String(from));
    }) as never);
    const spawnRun = (line: string) => {
      const child = makeChild();
      vi.mocked(cp.spawn).mockImplementation((() => {
        setTimeout(() => {
          child.stderr.emit('data', Buffer.from(line));
          healthOwner = 'owner-token';
          child.exitCode = 0;
          child.emit('exit', 0);
        }, 0);
        return child as never;
      }) as never);
    };
    const logPath = path.join('/tmp/cowork-test-logs', 'cowork-server.log');

    spawnRun('first run: inference 404\n');
    expect((await startServer({ port: PORT, readyTimeoutMs: 60_000 })).ok).toBe(true);
    await stopServer();
    healthOwner = null;
    spawnRun('second run: booted\n');
    expect((await startServer({ port: PORT, readyTimeoutMs: 60_000 })).ok).toBe(true);

    expect(files.get(`${logPath}.1`)).toContain('first run: inference 404');
    expect(files.get(logPath)).toContain('second run: booted');
    expect(files.get(logPath)).not.toContain('first run');
    await stopServer();
  });

  it('still spawns when the previous log cannot be rotated', async () => {
    vi.mocked(fs.renameSync).mockImplementation((() => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
    }) as never);
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { healthOwner = 'owner-token'; child.exitCode = 0; child.emit('exit', 0); }, 0);
      return child as never;
    }) as never);

    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(true);
    expect(vi.mocked(fs.createWriteStream)).toHaveBeenCalledWith(expect.stringContaining('cowork-server.log'), { flags: 'w' });
    await stopServer();
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

  it('tracks a handed-off backend and replaces it if it later disappears', async () => {
    // A Windows launcher can exit after handing off to Python; a healthy server must still count as
    // running.
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

    // The handed-off Python process has no ChildProcess handle; missing health must allow ensure to
    // replace it despite serverStarted.
    healthOwner = null;
    const replacement = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { healthOwner = 'owner-token'; }, 0);
      return replacement as never;
    }) as never);
    vi.mocked(process.kill).mockImplementation(((pid: number, signal?: string) => {
      signals.push([pid, String(signal)]);
      replacement.exitCode = 0;
      setTimeout(() => replacement.emit('exit', 0), 0);
      return true;
    }) as never);
    const spawnCount = vi.mocked(cp.spawn).mock.calls.length;

    const recovered = await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    expect(recovered.ok).toBe(true);
    expect(vi.mocked(cp.spawn).mock.calls).toHaveLength(spawnCount + 1);
    await stopServer(); // leave the module's state clean for the next test
  });

  it('replaces an owned but incompatible sidecar instead of adopting its healthy port', async () => {
    healthOwner = 'owner-token';
    healthCapabilities = [];
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { healthCapabilities = ['coding']; }, 0);
      return child as never;
    }) as never);

    const result = await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    expect(vi.mocked(cp.spawn)).toHaveBeenCalledTimes(1);
    vi.mocked(process.kill).mockImplementation(((pid: number, signal?: string) => {
      signals.push([pid, String(signal)]);
      child.exitCode = 0;
      setTimeout(() => child.emit('exit', 0), 0);
      return true;
    }) as never);
    await stopServer();
  });

  it('reports a freshly spawned incompatible backend immediately', async () => {
    healthOwner = 'owner-token';
    healthCapabilities = [];
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => child as never) as never);

    const startedAt = Date.now();
    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(false);
    // Includes the bounded child reaping window, but never the 60 s startup
    // cap that an incompatible health response used to consume.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(getServerDiagnostics().lastErrorKind).toBe('incompatible');
    expect(getServerDiagnostics().lastError).toContain('too old');
  });

  it('checkpoints active coding tasks before terminating the sidecar tree', async () => {
    const child = makeChild();
    healthOwner = 'owner-token';
    vi.mocked(cp.spawn).mockImplementation((() => child as never) as never);
    vi.mocked(process.kill).mockImplementation(((pid: number, signal?: string) => {
      signals.push([pid, String(signal)]);
      child.exitCode = 0;
      setTimeout(() => child.emit('exit', 0), 0);
      return true;
    }) as never);

    expect((await startServer({ port: PORT, readyTimeoutMs: 5_000 })).ok).toBe(true);
    await stopServer();

    const checkpoint = vi.mocked(fetch);
    expect(checkpoint).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/v1/coding/runtime/prepare-shutdown`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(process.kill).mock.invocationCallOrder[0],
    );
  });

  it('checkpoints coding tasks on an adopted sidecar before reaping it by port', async () => {
    // Adopted sidecars lack a ChildProcess handle but still need a checkpoint before stopping.
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { healthOwner = 'owner-token'; child.exitCode = 0; child.emit('exit', 0); }, 0);
      return child as never;
    }) as never);
    expect((await startServer({ port: PORT, readyTimeoutMs: 5_000 })).ok).toBe(true);
    const env = (vi.mocked(cp.spawn).mock.calls[0]?.[2] as cp.SpawnOptions).env ?? {};
    await stopServer();
    vi.mocked(fetch).mockClear();
    vi.mocked(cp.execFile).mockClear();
    execCalls = [];

    healthOwner = env.COWORK_SERVER_OWNER ?? null;
    expect((await startServer({ port: PORT, readyTimeoutMs: 5_000 })).ok).toBe(true);
    expect(cp.spawn).toHaveBeenCalledTimes(1);
    await stopServer();

    const checkpoint = vi.mocked(fetch);
    expect(checkpoint).toHaveBeenCalledWith(
      `http://127.0.0.1:${PORT}/api/v1/coding/runtime/prepare-shutdown`,
      expect.objectContaining({ method: 'POST' }),
    );
    const reapIndex = execCalls.findIndex((c) => c.cmd === 'lsof' && c.args.includes(`tcp:${PORT}`));
    expect(reapIndex).toBeGreaterThanOrEqual(0);
    expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cp.execFile).mock.invocationCallOrder[reapIndex],
    );
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
    // Kill the process group, including Python children, so no orphan retains the server port.
    expect(signals).toContainEqual([-4242, 'SIGTERM']);
  });

  it('does not spend the reap timeout on an exit event that can never arrive', async () => {
    // A failed spawn emits error without exit; do not wait for an exit event from a nonexistent
    // process.
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => child.emit('error', new Error('spawn ENOENT')), 0);
      return child as never;
    }) as never);

    const startedAt = Date.now();
    await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(signals).toEqual([]);
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

  // Ignore localized netstat state text. Match TCP, local port, all-zero foreign address and the
  // final PID column.
  // Vary both state-token count and script; the synthetic three-token state guards unknown locales
  // without enumerating languages.
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

describe('dev-mode uv resolution', () => {
  // Dev startup must use the installer's uv resolution, including PATH-only winget/scoop/pip
  // installations.
  afterEach(() => {
    (app as { isPackaged: boolean }).isPackaged = true;
    delete process.env.COWORK_SERVER_DIR;
  });

  function enterDevMode() {
    (app as { isPackaged: boolean }).isPackaged = false;
    process.env.COWORK_SERVER_DIR = '/dev/cowork-server';
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('pyproject.toml'));
  }

  it('spawns `uv run` with the resolveUv-resolved binary (PATH-only uv included)', async () => {
    enterDevMode();
    uvState.resolveUv = '/custom/tools/uv';

    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => child.emit('error', new Error('spawn EPERM')), 0);
      return child as never;
    }) as never);

    await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    const spawnCall = vi.mocked(cp.spawn).mock.calls[0];
    expect(spawnCall?.[0]).toBe('/custom/tools/uv');
    expect(spawnCall?.[1]).toEqual(['run', 'cowork-server']);
  });

  it('passes only the fixed development OAuth file location to a local server', async () => {
    enterDevMode();
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => child.emit('error', new Error('stop after env capture')), 0);
      return child as never;
    }) as never);

    await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    const options = vi.mocked(cp.spawn).mock.calls[0]?.[2] as cp.SpawnOptions;
    expect(options.env).toMatchObject({
      COWORK_DEV_OAUTH_ENV_FILE: path.join(os.homedir(), '.cowork-dev', '.env'),
    });
    expect(options.env).not.toHaveProperty('GITHUB_CLIENT_SECRET');
    expect(options.env).not.toHaveProperty('LINEAR_CLIENT_SECRET');
  });

  it('reports a useful reason and never spawns when uv is unresolvable', async () => {
    enterDevMode();
    uvState.resolveUv = null;

    const result = await startServer({ port: PORT, readyTimeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('uv not found');
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});

describe('resolveServerPort', () => {
  // stopServer clears the resolved-port memo so each case probes afresh.
  afterEach(async () => { await stopServer(); });

  it('moves off a port held by another install even when that server is too old to be compatible', async () => {
    // An owned server predating the coding capability probed as incompatible,
    // fell through to reap-and-respawn, and failed with EPERM then EADDRINUSE.
    healthOwner = 'someone-elses-token';
    healthCapabilities = [];

    const port = await resolveServerPort();

    expect(net.createServer).toHaveBeenCalled();
    expect(port).toBe(FREE_PORT);
  });

  it('keeps the preferred port for an owner-less legacy server so startServer can reap it', async () => {
    healthOwner = '';

    const port = await resolveServerPort();

    expect(net.createServer).not.toHaveBeenCalled();
    expect(port).not.toBe(FREE_PORT);
  });
});

describe('post-start credential hook', () => {
  // Every sidecar start loses its in-memory credential and must repush it, including stop/start and
  // updates.
  afterEach(async () => {
    setServerStartedHook(null);
    // Always stop during cleanup: leaked module-level serverStarted would short-circuit the next
    // case after an assertion failure.
    if (isServerRunning()) await stopServer();
  });

  /** Spawn a child that comes up healthy, the way a real start does. */
  function spawnHealthy(): void {
    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { healthOwner = 'owner-token'; child.exitCode = 0; child.emit('exit', 0); }, 0);
      return child as never;
    }) as never);
  }

  it('re-establishes the credential on the start half of a stop/start', async () => {
    const hook = vi.fn().mockResolvedValue(true);
    setServerStartedHook(hook);

    spawnHealthy();
    await startServer({ port: PORT, readyTimeoutMs: 60_000 });
    expect(hook).toHaveBeenCalledTimes(1);

    await stopServer();
    spawnHealthy();
    await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    // The second start is the one that matters: the sidecar that went down took
    // the credential with it.
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('awaits the hook, so a caller reading /health sees a configured install', async () => {
    /*
     * Hold the hook behind a gate and assert startServer is still pending.
     * A flag set before the hook's first await would also pass if startup stopped awaiting the
     * credential push.
     */
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    setServerStartedHook(async () => { entered = true; await gate; });

    spawnHealthy();
    const started = startServer({ port: PORT, readyTimeoutMs: 60_000 });
    let resolved = false;
    void started.then(() => { resolved = true; });

    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      await new Promise((resolve) => setImmediate(resolve));
      expect(resolved).toBe(false);
    } finally {
      release();
    }

    await started;
    expect(resolved).toBe(true);
  });

  it('does not hand a credential to a start that failed', async () => {
    const hook = vi.fn();
    setServerStartedHook(hook);

    const child = makeChild();
    vi.mocked(cp.spawn).mockImplementation((() => {
      setTimeout(() => { child.exitCode = 1; child.emit('exit', 1); }, 0);
      return child as never;
    }) as never);

    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it('still reports a successful start when the hand-over throws', async () => {
    // A sidecar that is up is up. The hook reports its own failures; losing the
    // start result would turn a recoverable push failure into a dead backend.
    setServerStartedHook(async () => { throw new Error('loopback refused'); });

    spawnHealthy();
    const result = await startServer({ port: PORT, readyTimeoutMs: 60_000 });

    expect(result.ok).toBe(true);
    expect(isServerRunning()).toBe(true);
  });
});
