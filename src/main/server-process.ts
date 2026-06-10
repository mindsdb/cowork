// Spawns the cowork-server FastAPI backend and waits for /health to come up.
//
// In dev: `uv run cowork-server` from the sibling cowork-server directory
// so local source edits are picked up immediately.
//
// In production (packaged Electron or web): runs the `cowork-server`
// binary installed via `uv tool install cowork-server`. No bundled source
// directory needed — the installer handles package installation.

import { spawn, execFile, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';

const DEFAULT_PORT = 26866; // ANTON on T9 keypad
const SERVER_HOST = '127.0.0.1';

let serverProcess: ChildProcess | null = null;
let serverPort: number = DEFAULT_PORT;
let serverStarted = false;
// Tracks an in-flight startServer() call so concurrent invocations
// share the same promise instead of spawning duplicate python processes
// (which would race for the same port and the second would fail).
let pendingStart: Promise<StartServerResult> | null = null;

// Diagnostics — captured so the renderer can surface them in a help
// modal when the user wonders why the backend is offline. We keep
// the most recent start failure reason and a rolling tail of stderr
// (latest ~32 KB) since the python crash trace usually lives in the
// last few lines. Flushed on a successful start.
const STDERR_BUFFER_BYTES = 32 * 1024;
let recentStderr = '';
let lastStartError: string | null = null;
let lastStartAt: number | null = null;
let lastExitCode: number | null = null;
// Whether the most-recent transition to "not running" was caused by
// a user/app-initiated stopServer() call. Distinguishes:
//   true  → user clicked Stop (or app is quitting). Modal shows
//           a calm "You stopped the backend" panel.
//   false → python died on its own (crash, external kill, OOM).
//           Modal shows the failure-style "didn't start / didn't
//           stay up" panel with the log tail.
//   null  → never stopped this session (initial state pre-first-stop).
let lastStopIntentional: boolean | null = null;
// Set true while stopServer() is running so the child's exit event
// can attribute the death correctly. Reset to false in the exit
// handler.
let _stopRequested = false;

function appendStderr(chunk: string) {
  recentStderr = (recentStderr + chunk).slice(-STDERR_BUFFER_BYTES);
}

// Kill a child process and its entire process group (POSIX). When we
// spawn with detached:true the child leads its own group, so
// process.kill(-pid) reaches grandchildren (e.g. python spawned by uv).
// Falls back to child.kill() on Windows or if the group kill fails.
function killTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && proc.pid) {
    try { process.kill(-proc.pid, signal); return; } catch {}
  }
  try { proc.kill(signal); } catch {}
}

// Find and kill the process listening on a port. Used to reap orphaned
// servers that we adopted but don't have a ChildProcess handle for.
// Best-effort — failures are silently ignored.
async function killProcessOnPort(port: number): Promise<void> {
  if (process.platform === 'win32') {
    console.warn(`[server] cannot reap orphaned process on port ${port}: lsof not available on Windows`);
    return;
  }
  return new Promise<void>((resolve) => {
    execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve(); return; }
      for (const pidStr of stdout.trim().split('\n')) {
        const pid = Number(pidStr);
        if (pid > 0) {
          try { process.kill(pid, 'SIGTERM'); } catch {}
        }
      }
      resolve();
    });
  });
}

export function getServerPort(): number {
  return serverPort;
}

export function getServerOrigin(): string {
  return `http://${SERVER_HOST}:${serverPort}`;
}

function getUvPath(): string | null {
  const localBin = path.join(os.homedir(), '.local', 'bin', 'uv');
  if (fs.existsSync(localBin)) return localBin;
  // Check common install paths
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin', 'uv');
  if (fs.existsSync(cargoBin)) return cargoBin;
  return null;
}

// Build a PATH with ~/.local/bin and ~/.cargo/bin prepended. Critical
// for macOS (and to a lesser extent Linux) GUI launches: when Minds Cowork.app
// starts from Finder/Dock, process.env.PATH is the minimal launchd PATH
// (`/usr/bin:/bin:/usr/sbin:/sbin`) — shell init files aren't read,
// so `~/.local/bin` (where the installer puts `uv`) is missing.
function getEnvPath(): string {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  const parts = [localBin, cargoBin, currentPath].filter(Boolean);
  return parts.join(path.delimiter);
}

// In dev mode, return the sibling cowork-server source directory so we
// can run `uv run cowork-server` against local source. Returns null when
// packaged (the installed binary is used instead).
function getDevServerDir(): string | null {
  if (app.isPackaged) return null;
  if (process.env.COWORK_SERVER_DIR) {
    return path.resolve(process.env.COWORK_SERVER_DIR);
  }
  return path.join(__dirname, '..', '..', '..', '..', 'cowork-server');
}

// Locate the installed `cowork-server` binary (installed via
// `uv tool install cowork-server`). Lives in ~/.local/bin on
// POSIX, %LOCALAPPDATA%/bin on Windows.
function getCoworkServerBin(): string | null {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const localCandidate = path.join(localBin, process.platform === 'win32' ? 'cowork-server.exe' : 'cowork-server');
  if (fs.existsSync(localCandidate)) return localCandidate;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const winCandidate = path.join(process.env.LOCALAPPDATA, 'bin', 'cowork-server.exe');
    if (fs.existsSync(winCandidate)) return winCandidate;
  }
  return null;
}

async function probeHealth(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { hostname: SERVER_HOST, port: serverPort, path: '/api/v1/health/', timeout: 1000 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.warn(`[server] health check failed after ${timeoutMs}ms on port ${serverPort}`);
  return false;
}

export interface StartServerResult {
  ok: boolean;
  reason?: string;
  port?: number;
}

export async function startServer(opts: { port?: number; readyTimeoutMs?: number } = {}): Promise<StartServerResult> {
  if (serverStarted) return { ok: true, port: serverPort };
  // If a start is already in progress (e.g. from app boot), reuse it
  // instead of spawning a second python that would clash on the port.
  if (pendingStart) return pendingStart;

  // TODO: Remove ANTON_SERVER_PORT fallback once migration period is over
  serverPort = opts.port ?? (Number(process.env.COWORK_SERVER_PORT) || Number(process.env.ANTON_SERVER_PORT) || DEFAULT_PORT);

  // Pre-flight: somebody might already be on our port. The most
  // common cause is an orphan python from a prior antontron session
  // that didn't get reaped on quit. If `/health` answers cleanly we
  // adopt that process — there's no point spawning a second python
  // that would fail to bind. Renderer-initiated re-starts after a
  // user "Stop" hit this same path; the brief 500ms probe is cheap
  // enough to be unconditional.
  const alreadyHealthy = await probeHealth(500);
  if (alreadyHealthy) {
    serverStarted = true;
    _adoptedExternal = true;
    lastStartError = null;
    console.log(`[server] adopted existing instance on port ${serverPort}`);
    return { ok: true, port: serverPort };
  }

  // 15s is plenty for a normal boot (typically <2s). Updates are now
  // handled by the Electron-side server-updater after the server is
  // already serving, so no need for a long timeout here.
  const readyTimeoutMs = opts.readyTimeoutMs ?? 15000;

  lastStartAt = Date.now();
  // A new start attempt invalidates the prior stop attribution —
  // whether the previous death was intentional or a crash, the
  // user is now asking for a fresh boot. Reset so the next
  // transition to "not running" reflects this start cycle's reason.
  lastStopIntentional = null;
  _stopRequested = false;
  _adoptedExternal = false;

  // Determine how to spawn the server:
  //   Dev mode:  `uv run cowork-server` from the sibling source dir
  //   Packaged:  run the installed `cowork-server` binary directly
  const devDir = getDevServerDir();
  let spawnCmd: string;
  let spawnArgs: string[];
  let spawnCwd: string | undefined;

  if (devDir && fs.existsSync(path.join(devDir, 'pyproject.toml'))) {
    // Dev: use uv to run from source so local edits are picked up
    const uvCmd = getUvPath();
    if (!uvCmd) {
      lastStartError = 'uv not found. Install uv first: https://docs.astral.sh/uv/getting-started/installation/';
      return { ok: false, reason: lastStartError };
    }
    spawnCmd = uvCmd;
    spawnArgs = ['run', 'cowork-server'];
    spawnCwd = devDir;
  } else {
    // Packaged: use the installed cowork-server binary
    const bin = getCoworkServerBin();
    if (!bin) {
      lastStartError = 'cowork-server not installed. Run the installer to set up the backend.';
      return { ok: false, reason: lastStartError };
    }
    spawnCmd = bin;
    spawnArgs = [];
    spawnCwd = undefined;
  }

  pendingStart = (async (): Promise<StartServerResult> => {
    const env = {
      ...process.env,
      PATH: getEnvPath(),
      PYTHONUNBUFFERED: '1',
      COWORK_SERVER_PORT: String(serverPort),
      COWORK_SERVER_HOST: SERVER_HOST,
    };

    // detached: true on POSIX puts the child in its own process group so
    // we can kill the entire tree (uv + grandchild python) with a single
    // process.kill(-pid). Without this, SIGTERM only reaches `uv` and
    // the grandchild python survives, holding the port.
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: spawnCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    child.stdout.on('data', (d) => {
      const text = d.toString();
      // Server logs go to stdout via uvicorn — the python crash trace
      // we want to surface lives on stderr, but errors propagated
      // through logging.error often land on stdout too. Buffer both
      // so the help modal has the complete picture.
      appendStderr(text);
      process.stdout.write(`[cowork-server] ${text}`);
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      appendStderr(text);
      process.stderr.write(`[cowork-server] ${text}`);
    });
    child.on('exit', (code) => {
      serverStarted = false;
      serverProcess = null;
      lastExitCode = code;
      // Attribute the death: if `_stopRequested` is set, this exit
      // was caused by stopServer() (user clicked Stop, or the app is
      // quitting). Otherwise the python died on its own — surface
      // that in the diagnostics so the modal shows the failure
      // panel instead of a calm "you stopped it" message.
      lastStopIntentional = _stopRequested;
      _stopRequested = false;
      if (code !== 0 && code !== null) {
        console.error(`[cowork-server] exited with code ${code}`);
      }
    });

    serverProcess = child;

    const ready = await probeHealth(readyTimeoutMs);
    if (!ready) {
      lastStartError = `Server did not respond on /health within ${readyTimeoutMs}ms.`;
      // Reap the spawned child instead of leaving it as a zombie
      // pinning the port. If we don't, every failed restart leaks a
      // python that still owns 26866, so subsequent restart attempts
      // bind-collide and fail the same way — making the "stop +
      // start" cycle look broken from the user's side. SIGTERM with
      // a SIGKILL fallback so a hung uvicorn boot can't outlive us.
      killTree(child, 'SIGTERM');
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
      await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 2_000))]);
      if (child.exitCode === null && !child.killed) {
        killTree(child, 'SIGKILL');
        await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 1_000))]);
      }
      if (serverProcess === child) serverProcess = null;
      return {
        ok: false,
        reason: lastStartError,
        port: serverPort,
      };
    }
    serverStarted = true;
    // Successful start — clear the previous failure note but keep
    // the rolling stderr in case downstream code wants to inspect.
    lastStartError = null;
    return { ok: true, port: serverPort };
  })();

  try {
    return await pendingStart;
  } finally {
    pendingStart = null;
  }
}

// Stop the python child and wait for it to actually exit before
// returning. Earlier the function fired SIGTERM and immediately nulled
// `serverProcess`, which let a subsequent `startServer()` race ahead
// and spawn a new python on a port the dying child still owned —
// surfacing as a 15s /health timeout instead of an obvious failure.
//
// Three phases:
//   1. SIGTERM, wait up to 3s for graceful shutdown.
//   2. SIGKILL, wait up to 1.5s for hard kill.
//   3. Clear the slot regardless — if the OS truly orphaned the child,
//      we'd rather lose track of it than block app quit forever.
export async function stopServer(): Promise<void> {
  const proc = serverProcess;
  if (!proc) {
    serverStarted = false;
    lastStopIntentional = true;
    // If we adopted an external server (no child handle), try to kill
    // whatever is listening on the port so the next launch gets a clean
    // slate. Without this, the orphan survives app quit and blocks the
    // port indefinitely.
    if (_adoptedExternal) {
      _adoptedExternal = false;
      await killProcessOnPort(serverPort);
    }
    return;
  }

  // Tell the child's exit handler this death is intentional. Set
  // BEFORE the kill so there's no chance the exit event fires before
  // we've recorded our intent.
  _stopRequested = true;

  // Mark not-running immediately so the renderer's `isServerRunning`
  // check reflects intent. We keep `serverProcess` non-null until we
  // actually verify exit so a racing startServer can't double-spawn.
  serverStarted = false;

  const exited = new Promise<void>((resolve) => {
    proc.once('exit', () => resolve());
    // 'close' fires after exit + stdio close; 'exit' is enough for
    // port release on POSIX. If we ever lose 'exit' (very rare), the
    // race-with-timeout below covers us.
  });

  killTree(proc, 'SIGTERM');

  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);

  // Still alive? Force-kill. `proc.exitCode === null` means the child
  // hasn't reported an exit code yet → still running.
  if (proc.exitCode === null && !proc.killed) {
    killTree(proc, 'SIGKILL');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ]);
  }

  // Clear the slot only if it still points at the same child — a
  // concurrent startServer() may have replaced it (shouldn't happen
  // with the renderer's serial restart flow but safe-guards against
  // future callers that don't await stopServer).
  if (serverProcess === proc) {
    serverProcess = null;
  }
}

// Track whether we adopted an external server (no child process to manage)
// vs spawned our own. When adopted, serverProcess is expected to be null.
let _adoptedExternal = false;

// True once /health has confirmed the python is responsive.
// When we spawned the child ourselves, also checks that the process
// handle is still alive — prevents returning true after an unexpected
// crash that nulled serverProcess via the exit handler.
// When we adopted an externally-started server (no child to track),
// trusts the serverStarted flag since we don't own the process.
export function isServerRunning(): boolean {
  if (!serverStarted) return false;
  if (_adoptedExternal) return true;
  return serverProcess !== null;
}

// True between spawn() and the first successful /health probe — i.e.
// the python child exists but isn't proven ready yet. The renderer
// uses this to show "starting…" without firing a duplicate start.
export function isServerStarting(): boolean {
  return pendingStart !== null;
}

export interface ServerDiagnostics {
  running: boolean;
  starting: boolean;
  port: number;
  /** Last failure reason from startServer(); null after a successful start. */
  lastError: string | null;
  /** Last exit code if the process has died. */
  lastExitCode: number | null;
  /** Wall-clock ms of the last start attempt; null until first attempt. */
  lastStartAt: number | null;
  /** Tail of stdout+stderr since this run of the main process. */
  recentLog: string;
  /**
   * Whether the most-recent transition to "not running" was caused by a
   * user/app stopServer() call (true) vs an unexpected exit (false).
   * Null until the first stop happens this session. The renderer uses
   * this to choose between a calm "you stopped the backend" panel and
   * the failure-style "didn't start / crashed" panel.
   */
  lastStopIntentional: boolean | null;
}

export function getServerDiagnostics(): ServerDiagnostics {
  return {
    running: isServerRunning(),
    starting: isServerStarting(),
    port: serverPort,
    lastError: lastStartError,
    lastExitCode,
    lastStartAt,
    recentLog: recentStderr,
    lastStopIntentional,
  };
}
