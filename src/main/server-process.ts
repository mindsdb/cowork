// Spawns the cowork-server FastAPI backend and waits for /health to come up.
//
// In dev: `uv run cowork-server` from the sibling cowork-server directory
// so local source edits are picked up immediately.
//
// In production (packaged Electron or web): runs the `cowork-server`
// binary installed via `uv tool install cowork-server`. No bundled source
// directory needed — the installer handles package installation.

import { spawn, execFile, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { coworkHome, buildKind } from './cowork-home';
import { MINDS_ENV_SLUG } from './minds-urls';
import { withServerLifecycle } from './server-lifecycle';
import { decideStartWait, startFailureMessage } from './update-logic';
import { getEnvPath, findUv, coworkServerBinCandidates } from './uv-paths';
import {
  SERVER_START_CAP_MS,
  type ServerStartErrorKind,
} from '../shared/server-status';

const DEFAULT_PORT = 26866; // legacy port (ANTON on T9 keypad)
const SERVER_HOST = '127.0.0.1';

// ENG-439: the sidecar binds a loopback port, which is machine-global, not
// per-OS-user. With fast user switching, whichever user launches first owns
// the port and every other user's app would adopt it — driving the first
// user's server and reading/writing their data. Two guards close that:
//   1. A per-OS-user port so two users don't land on the same port.
//   2. An owner token echoed at /health — we adopt a running server only
//      when its owner matches the token we generated.
// Per-user port band: 26866..(26866+PORT_SPAN-1), clear of common dev ports.
const PORT_SPAN = 2000;

// Per-install owner token. Persisted under ~/.cowork (per-OS-user by
// filesystem perms), passed to the server via COWORK_SERVER_OWNER, and
// echoed back at /health so we can tell our own server from a foreign one.
let _ownerToken: string | null = null;
function serverOwnerToken(): string {
  if (_ownerToken) return _ownerToken;
  const tokenPath = path.join(coworkHome(), '.server_owner');
  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
      if (existing) { _ownerToken = existing; return _ownerToken; }
    }
  } catch {
    // fall through and (re)create
  }
  const token = crypto.randomBytes(16).toString('hex');
  try {
    // Owner-only perms (0700 dir / 0600 file): the token gates server adoption
    // (ENG-439). macOS home dirs are commonly traversable, so a readable token
    // would let another OS user set the same COWORK_SERVER_OWNER and
    // deliberately adopt our server — defeating the identity check. chmod after
    // write pins the mode regardless of umask.
    fs.mkdirSync(coworkHome(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenPath, token + '\n', { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(tokenPath, 0o600);
  } catch {
    // best-effort persistence; the token stays stable for this process at least
  }
  _ownerToken = token;
  return _ownerToken;
}

// Deterministic per-OS-user, per-build-kind port. Stable across launches for a
// given user+build (so we still adopt our OWN crash-orphan), distinct between
// users (so one user's app can't land on another's server) AND between builds
// (prod/preview/stable no longer share ~/.cowork, so they mustn't share a port
// either — otherwise a non-prod build would perpetually route around prod's
// server onto a fresh random port and never re-adopt its own orphan). Only
// used in the packaged app: dev/web reach the server through Vite's proxy /
// same-origin, which targets the fixed COWORK_SERVER_PORT||26866.
function preferredServerPort(): number {
  // uid is stable per macOS/Linux account; Windows has no real uid (-1), so
  // fall back to the home dir, which is per-user there.
  let key: string;
  try {
    const uid = os.userInfo().uid;
    key = uid >= 0 ? `uid:${uid}` : `home:${os.homedir()}`;
  } catch {
    key = `home:${os.homedir()}`;
  }
  // Non-prod builds get their own port band. Prod's key is left untouched so an
  // existing prod install still lands on its historical port and adopts the
  // orphan a pre-upgrade build may have left behind.
  const kind = buildKind();
  if (kind !== 'prod') key = `${key}|kind:${kind}`;
  const digest = crypto.createHash('sha256').update(key).digest();
  return DEFAULT_PORT + (digest.readUInt16BE(0) % PORT_SPAN);
}

// Bind :0 to let the OS hand back a free port — used only when our preferred
// per-user port is held by a foreign server (a rare uid-hash collision).
function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(0));
    srv.listen(0, SERVER_HOST, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function loadBundledServerCredentials(): Record<string, string> {
  try {
    const credPath = path.join(process.resourcesPath || '', 'server-credentials.json');
    if (fs.existsSync(credPath)) {
      const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (raw && typeof raw === 'object') return raw as Record<string, string>;
    }
  } catch {
    // no credentials file bundled (dev mode) — fine
  }
  return {};
}

let serverProcess: ChildProcess | null = null;
let serverPort: number = DEFAULT_PORT;
let serverStarted = false;
// Tracks an in-flight startServer() call so concurrent invocations
// share the same promise instead of spawning duplicate python processes
// (which would race for the same port and the second would fail).
let pendingStart: Promise<StartServerResult> | null = null;

/**
 * Run a complete server-maintenance transaction exclusively with starts and
 * stops. This must be entered before source inspection or a stop/install/start
 * sequence, rather than only around the `uv` subprocess.
 */
export async function withServerMaintenance<T>(fn: () => Promise<T>): Promise<T> {
  return withServerLifecycle(fn);
}

// Diagnostics — captured so the renderer can surface them in a help
// modal when the user wonders why the backend is offline. We keep
// the most recent start failure reason and a rolling tail of stdout/stderr
// (latest ~32 KB) for the current start attempt; the Python crash trace
// usually lives in its last few lines.
const STDERR_BUFFER_BYTES = 32 * 1024;
let recentStderr = '';
let lastStartError: string | null = null;
// Which kind of failure produced `lastStartError`. The renderer picks its
// explanation from this discriminant rather than string-matching the message,
// so the copy and the message can change independently.
let lastStartErrorKind: ServerStartErrorKind | null = null;
// A process found holding our port after a failed start — real evidence for
// the panel, which otherwise can only guess that "something may be on the
// port". Null when the port is free (the normal case).
let lastPortHolderPid: number | null = null;
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

/* On-disk log file. The in-memory `recentStderr` tail is only ~32 KB and
   dies with the app; the log file gives the user (and the Help > Reveal
   Logs menu item) the full server output for the current session,
   surviving until the next start. Opened fresh on each spawn so the file
   reflects the live session rather than growing unbounded across runs. */
let logStream: fs.WriteStream | null = null;

export function getServerLogPath(): string {
  /* Non-prod channels log under their isolated data home so launching one
     build kind never truncates another's log — every kind shares one
     app.getPath('logs') because they share a productName, and the stream opens
     with flags:'w'. prod keeps the historical getPath('logs') location
     (~/Library/Logs/<AppName> on macOS, %APPDATA%/<AppName>/logs on Windows,
     ~/.config/<AppName>/logs on Linux).
     Pure getter — the directory is created lazily in openLogStream(), so
     callers that only need the path (e.g. the Help > Reveal Logs menu item)
     don't trigger a filesystem write on every invocation. */
  if (buildKind() !== 'prod') return path.join(coworkHome(), 'logs', 'cowork-server.log');
  return path.join(app.getPath('logs'), 'cowork-server.log');
}

function openLogStream(): void {
  try {
    logStream?.end();
    const logPath = getServerLogPath();
    /* Electron does not guarantee the logs directory exists; create it
       here, at the one point we actually open the stream for writing. */
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const stream = fs.createWriteStream(logPath, { flags: 'w' });
    /* A failure to open surfaces ASYNCHRONOUSLY as an 'error' event, not as a
       throw from createWriteStream — so the try/catch alone never sees it. With
       no 'error' listener Node re-raises it as an uncaught exception, which
       Electron turns into a fatal "A JavaScript error occurred in the main
       process" dialog and blocks the whole app from starting (ENG-1187: EPERM =
       ERROR_ACCESS_DENIED on the log file — a read-only/ACL condition, a
       delete-pending file from a prior install's still-open handle, or AV
       controlled-folder protection). Logging to disk is best-effort: degrade to
       no disk log, keeping the in-memory recentStderr tail and the running app. */
    stream.on('error', () => { if (logStream === stream) logStream = null; });
    logStream = stream;
  } catch {
    /* Synchronous failures (e.g. mkdir denied) — same best-effort stance. */
    logStream = null;
  }
}

function writeLog(text: string): void {
  logStream?.write(text);
}

// Kill a child process and its entire process tree. When we spawn with
// detached:true (POSIX) the child leads its own group, so process.kill(-pid)
// reaches grandchildren (e.g. python spawned by uv).
//
// Windows has no process groups to signal, and the thing we spawn is a
// launcher that runs python as a child — so proc.kill() terminates the
// launcher and leaves python importing, unsupervised. It then binds our port
// behind the app's back: the app has no handle on it, its own
// isServerRunning() says nothing is up, and only a fresh app launch recovers
// via the adopt path. `taskkill /T` walks the tree, which is the whole point.
//
// /F (force) is used for the graceful phase too, because on Windows there is
// no polite form to try. Not because the sidecar can't answer one — uvicorn
// installs a SIGBREAK handler on win32 — but because nothing can deliver it as
// the child is spawned: `detached` is false on Windows so it never gets
// CREATE_NEW_PROCESS_GROUP, Electron main is a GUI process with no console to
// raise the event from, and the packaged target is a shim that would have to
// re-raise it into python anyway. Attempting it would cost a stall on every
// Stop and change nothing. The pre-existing behaviour here (TerminateProcess
// on the launcher) was never graceful either; this only widens it to the tree.
//
// What that costs, honestly: the DB is fine either way (SQLite runs its default
// rollback journal, and a TerminateProcess is gentler than the power cut it is
// already safe against). What is lost is the work the sidecar does in Python on
// the way down — an in-flight turn is written by a single persist() reached
// only from its own terminal handlers, so a hard kill mid-turn drops it. That
// gap is not specific to Windows and not created here: POSIX runs uvicorn with
// no graceful-shutdown timeout, so it waits unbounded on the open stream and
// takes the SIGKILL below instead. Closing it needs a cancel-then-stop
// handshake over loopback, which is its own change.
function killTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    const pid = proc.pid;
    if (pid) {
      // Numeric PID via execFile — no shell, nothing interpolated.
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 4000 }, (err) => {
        // taskkill also errors when the tree is already gone; the fallback is
        // a no-op then. Only reached when taskkill itself is unusable.
        if (err) { try { proc.kill(signal); } catch {} }
      });
      return;
    }
  } else if (proc.pid) {
    try { process.kill(-proc.pid, signal); return; } catch {}
  }
  try { proc.kill(signal); } catch {}
}

// PIDs currently listening on a port. Best-effort — an empty array means
// "nothing found", including the case where the lookup itself failed.
function findPortHolders(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    // lsof isn't available; parse `netstat -ano`.
    //
    // Nothing about the state column can be trusted. The word is localized
    // (ABHÖREN on a German Windows, ESCUCHANDO on a Spanish one), so matching
    // "LISTENING" made the whole orphan reap a silent no-op outside English
    // installs — on exactly the machines this matters for. Worse, some locales
    // render it as TWO words (Italian "IN ASCOLTO", French "À L'ÉCOUTE"), which
    // shifts every later column, so a fixed PID index is wrong there too.
    //
    // Two things that are NOT localized carry the whole match instead: the
    // foreign-address column, where a listening socket is the only TCP row with
    // an all-zero peer, and the PID, which is always the last column.
    return new Promise<number[]>((resolve) => {
      execFile('netstat', ['-ano'], { timeout: 4000 }, (err, stdout) => {
        if (err || !stdout) { resolve([]); return; }
        const pids = new Set<number>();
        for (const line of stdout.split(/\r?\n/)) {
          // columns: proto  local-addr  foreign-addr  state…  pid
          const cols = line.trim().split(/\s+/);
          if (cols.length < 5) continue; // UDP rows have no state column
          if (!/^TCP/i.test(cols[0])) continue;
          if (!cols[1].endsWith(`:${port}`)) continue;
          if (cols[2] !== '0.0.0.0:0' && cols[2] !== '[::]:0') continue;
          const pid = Number(cols[cols.length - 1]);
          if (pid > 0) pids.add(pid);
        }
        resolve([...pids]);
      });
    });
  }
  return new Promise<number[]>((resolve) => {
    execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve([]); return; }
      const pids = stdout.trim().split('\n').map(Number).filter((pid) => pid > 0);
      resolve([...new Set(pids)]);
    });
  });
}

// Find and kill whatever is listening on a port, returning the PIDs it went
// after. Used to reap orphaned servers we have no ChildProcess handle for —
// otherwise they surface as WinError 10048 / EADDRINUSE on every restart,
// because neither the OS nor our own quit always reaps the prior python.
// Best-effort — failures are silently ignored.
async function killProcessOnPort(port: number): Promise<number[]> {
  const pids = await findPortHolders(port);
  if (pids.length === 0) return [];
  if (process.platform === 'win32') {
    await Promise.all(pids.map((pid) => new Promise<void>((resolve) => {
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 4000 }, () => resolve());
    })));
    return pids;
  }
  const killed: number[] = [];
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); killed.push(pid); } catch {}
  }
  return killed;
}

export function getServerPort(): number {
  return serverPort;
}

export function getServerOrigin(): string {
  return `http://${SERVER_HOST}:${serverPort}`;
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

function getCoworkServerBin(): string | null {
  // Candidate order — including the prod-only Windows %LOCALAPPDATA% global
  // fallback — lives in uv-paths.coworkServerBinCandidates so it is unit-tested
  // alongside the rest of the per-channel binary isolation.
  for (const candidate of coworkServerBinCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Gap between health polls during a start, and the per-request timeout. The
// gap is short because the win case is "notice the moment it's up"; the
// request timeout is generous because a machine slow enough to need this fix
// is also slow to answer a loopback request. A missed probe just costs one
// more iteration.
const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_PROBE_TIMEOUT_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single-shot /health probe that also reads the `owner` token, so the
// adoption decision can check the running server is ours (ENG-439).
function probeHealthOnce(port: number, timeoutMs: number): Promise<{ ok: boolean; owner: string | null }> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: SERVER_HOST, port, path: '/api/v1/health/', timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve({ ok: false, owner: null }); return; }
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let owner: string | null = null;
          try { owner = (JSON.parse(body) as { owner?: string } | null)?.owner ?? null; } catch { /* non-JSON */ }
          resolve({ ok: true, owner });
        });
      },
    );
    req.on('error', () => resolve({ ok: false, owner: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, owner: null }); });
  });
}

// One-shot read of the server's /health payload. Best-effort — resolves null
// on any failure.
function fetchHealth(timeoutMs = 800): Promise<{ server_version?: string; anton_version?: string } | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: SERVER_HOST, port: serverPort, path: '/api/v1/health/', timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Reported CalVers of both hot-updated backend components in a single /health
// read, so the About panel can fold server AND agent into the unified version.
// The renderer's Settings view is the authoritative surface and reads the same
// fields directly.
export function fetchServerVersions(timeoutMs = 800): Promise<{ server: string | null; anton: string | null }> {
  return fetchHealth(timeoutMs).then((h) => ({
    server: h?.server_version ?? null,
    anton: h?.anton_version ?? null,
  }));
}

// True when resolveServerPort() found a healthy server that proved to be
// ours; startServer() re-verifies and adopts it instead of spawning.
let _adoptPlanned = false;
let _portResolved = false;

// Decide the port (and whether we can adopt an already-running server)
// BEFORE the window is created, so the resolved port can be handed to the
// renderer. ENG-439: we adopt only a server whose /health owner matches our
// own token; a foreign server holding our preferred port pushes us to a free
// one. Bounded + best-effort — any failure falls back to the preferred port
// so this can never block boot. Idempotent.
export async function resolveServerPort(): Promise<number> {
  if (_portResolved || serverStarted) return serverPort;
  try {
    // A dev/web/test override pins the port (and matches the Vite proxy).
    const explicit = Number(process.env.COWORK_SERVER_PORT) || Number(process.env.ANTON_SERVER_PORT) || 0;
    if (explicit) { serverPort = explicit; return serverPort; }

    const preferred = app.isPackaged ? preferredServerPort() : DEFAULT_PORT;
    serverPort = preferred;

    const probe = await probeHealthOnce(preferred, 700);
    if (probe.ok && probe.owner && probe.owner === serverOwnerToken()) {
      _adoptPlanned = true; // our own orphan — startServer will re-verify + adopt
    } else if (probe.ok && probe.owner) {
      // Healthy AND owned by a DIFFERENT install (another OS user) — never adopt
      // or touch it. Move to a free port we can own.
      const free = await findFreePort();
      if (free) serverPort = free;
      console.log(`[server] port ${preferred} held by a foreign server; using ${serverPort} instead`);
    }
    // else: not healthy, OR healthy but owner-less (a pre-ENG-439 server — on a
    // per-user port that's almost certainly our own from before this change).
    // Keep the preferred port; startServer reaps whatever's there and respawns.
    // A cross-user kill can't succeed (different OS user → EPERM), so the worst
    // case there is a safe bind failure, never adopting a foreign server.
  } catch (err) {
    console.warn('[server] resolveServerPort failed; falling back to preferred port', err);
  } finally {
    _portResolved = true;
  }
  return serverPort;
}

export interface StartServerResult {
  ok: boolean;
  reason?: string;
  port?: number;
}

export async function startServer(opts: { port?: number; readyTimeoutMs?: number } = {}): Promise<StartServerResult> {
  return withServerLifecycle(() => startServerUnlocked(opts));
}

async function startServerUnlocked(opts: { port?: number; readyTimeoutMs?: number }): Promise<StartServerResult> {
  if (serverStarted) return { ok: true, port: serverPort };
  // If a start is already in progress (e.g. from app boot), reuse it
  // instead of spawning a second python that would clash on the port.
  if (pendingStart) return pendingStart;

  // Resolve the port unless a caller pins one. resolveServerPort picks a
  // per-OS-user port and, when a server is already running there, records
  // whether it's ours (ENG-439). Idempotent — a no-op if boot already
  // resolved it before creating the window.
  if (opts.port) {
    serverPort = opts.port;
  } else {
    await resolveServerPort();
  }

  // Pre-flight adoption — adopt ONLY our own already-running server. The most
  // common cause is an orphan python from a prior session that didn't get
  // reaped on quit; re-verify via /health that the owner token is ours before
  // adopting (a foreign server was already routed around in resolveServerPort).
  if (_adoptPlanned || opts.port) {
    const probe = await probeHealthOnce(serverPort, 700);
    if (probe.ok && probe.owner && probe.owner === serverOwnerToken()) {
      serverStarted = true;
      _adoptedExternal = true;
      lastStartError = null;
      lastStartErrorKind = null;
      lastPortHolderPid = null;
      console.log(`[server] adopted our own existing instance on port ${serverPort}`);
      return { ok: true, port: serverPort };
    }
  }

  // Not healthy — but a crashed/hung orphan from a prior session may still
  // be holding the port (the OS doesn't always reap it, especially on
  // Windows). If so, our spawn would fail to bind with WinError 10048 /
  // EADDRINUSE. Reap any non-responsive listener first (no-op if the port is
  // actually free), then give the OS a moment to release the socket.
  const reaped = await killProcessOnPort(serverPort);
  if (reaped.length > 0) {
    console.log(`[server] reaped an orphan holding port ${serverPort} before spawn (pid ${reaped.join(', ')})`);
    await sleep(500);
  }

  // Hard cap on the wait — not an expected duration. The wait itself tracks
  // the child's liveness, so this only bounds a process that is still alive
  // and still starting. One cap for every build: a dev-only allowance would
  // mean a start that passes locally can still be killed in a packaged build,
  // so the failure would only ever reproduce on a customer's machine.
  const devServerDir = getDevServerDir();
  const isDevSource = Boolean(devServerDir && fs.existsSync(path.join(devServerDir, 'pyproject.toml')));
  const startCapMs = opts.readyTimeoutMs ?? SERVER_START_CAP_MS;

  lastStartAt = Date.now();
  // The repair classifier must only inspect output from this attempt. A prior
  // failed start may contain an import error while this one fails for an
  // unrelated reason (migration, port, or config).
  recentStderr = '';
  lastStartErrorKind = null;
  lastPortHolderPid = null;
  // A new start attempt invalidates the prior stop attribution —
  // whether the previous death was intentional or a crash, the
  // user is now asking for a fresh boot. Reset so the next
  // transition to "not running" reflects this start cycle's reason.
  lastStopIntentional = null;
  _stopRequested = false;
  _adoptedExternal = false;
  _adoptPlanned = false;

  // Determine how to spawn the server:
  //   Dev mode:  `uv run cowork-server` from the sibling source dir
  //   Packaged:  run the installed `cowork-server` binary directly
  const devDir = devServerDir;
  let spawnCmd: string;
  let spawnArgs: string[];
  let spawnCwd: string | undefined;

  if (isDevSource && devDir) {
    // Dev: use uv to run from source so local edits are picked up
    const uvCmd = findUv();
    if (!uvCmd) {
      lastStartError = 'uv not found. Install uv first: https://docs.astral.sh/uv/getting-started/installation/';
      lastStartErrorKind = 'not-installed';
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
      lastStartErrorKind = 'not-installed';
      return { ok: false, reason: lastStartError };
    }
    spawnCmd = bin;
    spawnArgs = [];
    spawnCwd = undefined;
  }

  pendingStart = (async (): Promise<StartServerResult> => {
    // Hand the server the same config home the desktop app uses so both sides
    // agree — including the per-build isolation (~/.cowork-<kind>) that keeps a
    // non-prod build off the production SQLite DB (ENG-324). cowork-server
    // derives every path from COWORK_HOME (see cowork.common.paths).
    //
    // Only set it for NON-prod builds. Prod's home is the server's own default
    // (~/.cowork), so leaving COWORK_HOME unset keeps prod byte-for-byte as
    // before this change — crucially, cowork-server drops the legacy
    // ~/.anton/.env fallback whenever COWORK_HOME is present, so setting it for
    // prod would silently stop consulting that file for un-migrated installs.
    const kind = buildKind();
    const dataHome = coworkHome();
    console.log(`[server] build kind "${kind}" → data home ${dataHome}`);
    const env = {
      ...process.env,
      ...loadBundledServerCredentials(),
      PATH: getEnvPath(),
      PYTHONUNBUFFERED: '1',
      // Both port names: COWORK_SERVER_PORT for every shipped server and
      // COWORK_LISTEN_PORT (the server's newer primary alias) so a future
      // alias cleanup server-side can never strand this app again.
      // Force Python UTF-8 mode so cowork-server (and the anton scratchpad it
      // spawns) never fall back to the host code page — e.g. GBK/cp936 on
      // Chinese Windows, which crashes on non-ASCII file reads / output
      // (ENG-824). UTF-8 mode already makes open()/filesystem/stdio UTF-8 with
      // the lenient surrogateescape handler; we deliberately do NOT set
      // PYTHONIOENCODING (a bare value downgrades stdio to strict). Respect an
      // explicit operator override if one is already set.
      PYTHONUTF8: process.env.PYTHONUTF8 || '1',
      COWORK_SERVER_PORT: String(serverPort),
      COWORK_LISTEN_PORT: String(serverPort),
      COWORK_SERVER_HOST: SERVER_HOST,
      // The server builds OAuth redirect URIs from server_origin, which
      // otherwise defaults to the fixed :26866. Since ENG-439 the packaged
      // server listens on a per-user derived port, so without this the
      // redirect points at a dead :26866 and "Allow" lands on an unreachable
      // page. Pin the origin to the port we actually spawned on. Google does
      // not validate the port for loopback (127.0.0.1) redirect URIs.
      COWORK_SERVER_ORIGIN: getServerOrigin(),
      ...(kind !== 'prod' ? { COWORK_HOME: dataHome } : {}),
      // ENG-439: stamp the server we spawn with our owner token so a future
      // launch (ours) can tell this server is ours and adopt it, while another
      // OS user's app sees a mismatch and never adopts it.
      COWORK_SERVER_OWNER: serverOwnerToken(),
      // Propagate the client's environment (staging/dev) to the server so its
      // own env-aware MindsHub defaults resolve to the same host the desktop
      // build points at. Only set when the build is baked for a non-prod env
      // and the caller hasn't already pinned ENV explicitly.
      ...(MINDS_ENV_SLUG && !process.env.ENV ? { ENV: MINDS_ENV_SLUG } : {}),
    };

    // detached: true on POSIX puts the child in its own process group so
    // we can kill the entire tree (uv + grandchild python) with a single
    // process.kill(-pid). Without this, SIGTERM only reaches `uv` and
    // the grandchild python survives, holding the port.
    openLogStream();

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
      writeLog(text);
      process.stdout.write(`[cowork-server] ${text}`);
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      appendStderr(text);
      writeLog(text);
      process.stderr.write(`[cowork-server] ${text}`);
    });
    // Whether this attempt's child is done, and why. Local to the attempt so a
    // late event from a previous child can't decide this one's outcome.
    let childExited = false;
    let childExitCode: number | null = null;
    let spawnError: string | null = null;

    // A spawn that never happens (EPERM from antivirus, ENOENT on a broken uv
    // shim) emits 'error' and nothing else — no stdout, no stderr, no exit.
    // Without this listener that whole class of failure was invisible and got
    // reported as a health timeout with an empty log, which sent users looking
    // for a slow backend when the program had not run at all. Node also throws
    // an unhandled 'error' when nothing is listening.
    child.on('error', (err) => {
      spawnError = err instanceof Error ? err.message : String(err);
      // Put it where the diagnostics tail and the on-disk log will show it, so
      // "no log captured" stops being the only evidence of a launch failure.
      appendStderr(`spawn failed: ${spawnError}\n`);
      writeLog(`[cowork-server] spawn failed: ${spawnError}\n`);
      console.error(`[cowork-server] spawn failed: ${spawnError}`);
    });
    child.on('exit', (code) => {
      childExited = true;
      childExitCode = code;
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
      logStream?.write(`\n[cowork-server] process exited with code ${code}\n`);
      logStream?.end();
      logStream = null;
      if (code !== 0 && code !== null) {
        console.error(`[cowork-server] exited with code ${code}`);
      }
    });

    serverProcess = child;

    // Wait on the child's liveness, not on a fixed timer: poll /health for as
    // long as the process is alive and still starting, up to the hard cap. A
    // slow machine gets the time it needs; a sidecar that dies is reported the
    // moment it dies rather than after the full budget.
    const waitStartedAt = Date.now();
    let step = decideStartWait({ healthy: false, spawnError, exited: childExited, elapsedMs: 0, capMs: startCapMs });
    while (step.action === 'poll') {
      await sleep(HEALTH_POLL_INTERVAL_MS);
      const probe = await probeHealthOnce(serverPort, HEALTH_PROBE_TIMEOUT_MS);
      step = decideStartWait({
        healthy: probe.ok,
        spawnError,
        exited: childExited,
        elapsedMs: Date.now() - waitStartedAt,
        capMs: startCapMs,
      });
    }

    if (step.action === 'fail') {
      const elapsedMs = Date.now() - waitStartedAt;
      lastStartErrorKind = step.kind;
      lastStartError = startFailureMessage({
        kind: step.kind,
        exitCode: childExitCode,
        spawnError,
        elapsedMs,
      });
      console.error(`[server] start failed on port ${serverPort}: ${lastStartError}`);
      // Reap the spawned child instead of leaving it as a zombie
      // pinning the port. If we don't, every failed restart leaks a
      // python that still owns the port, so subsequent restart attempts
      // bind-collide and fail the same way — making the "stop +
      // start" cycle look broken from the user's side. SIGTERM with
      // a SIGKILL fallback so a hung uvicorn boot can't outlive us.
      //
      // Skipped when the spawn itself failed: there is no process to reap, and
      // Node never emits 'exit' for one that never existed, so the wait below
      // would spend its full 2s on an event that cannot arrive — on the one
      // failure path whose entire point is that it reports immediately.
      if (!childExited && !spawnError) {
        killTree(child, 'SIGTERM');
        const exited = new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
        });
        await Promise.race([exited, sleep(2_000)]);
        if (child.exitCode === null && !child.killed) {
          killTree(child, 'SIGKILL');
          await Promise.race([exited, sleep(1_000)]);
        }
      }
      // Whatever still holds the port after the reap is a real, nameable
      // cause the user can act on — as opposed to the panel's old guess that
      // "a stale process" might be involved.
      lastPortHolderPid = (await findPortHolders(serverPort))[0] ?? null;
      if (serverProcess === child) serverProcess = null;
      return {
        ok: false,
        reason: lastStartError,
        port: serverPort,
      };
    }
    serverStarted = true;
    // /health answered from a server whose launcher has already exited — the
    // process handed off and there is no child left to supervise. Track it the
    // same way as a server we adopted, so isServerRunning() doesn't call a
    // healthy backend dead and stopServer() still reaps it by port.
    if (childExited) _adoptedExternal = true;
    // How long the start actually took. Only failures used to say anything,
    // which meant a slow-but-successful boot — the case this budget exists for
    // — left no trace at all, and a support log could not distinguish "came up
    // in 2s" from "came up in 80s and nearly missed the cap".
    console.log(`[server] healthy on port ${serverPort} after ${Date.now() - waitStartedAt}ms`);
    // Successful start — clear the previous failure note but keep
    // the rolling stderr in case downstream code wants to inspect.
    lastStartError = null;
    lastStartErrorKind = null;
    lastPortHolderPid = null;
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
//   1. SIGTERM, wait up to 6s for graceful shutdown. Sized to outlast the
//      sidecar's own shutdown work rather than picked round: its channel
//      drain alone budgets 3s, so the previous 3s here could never let the
//      rest of its teardown finish. The wait ends the moment the child exits,
//      so a healthy stop still returns in milliseconds and only a genuinely
//      slow shutdown spends the extra time.
//   2. SIGKILL, wait up to 1.5s for hard kill.
//   3. Clear the slot regardless — if the OS truly orphaned the child,
//      we'd rather lose track of it than block app quit forever.
export async function stopServer(): Promise<void> {
  return withServerLifecycle(stopServerUnlocked);
}

async function stopServerUnlocked(): Promise<void> {
  // Allow the next start to re-resolve the port (re-derive the per-user port
  // and re-check whether anything is running there). ENG-439.
  _portResolved = false;
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
    new Promise<void>((resolve) => setTimeout(resolve, 6_000)),
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

// Last-resort reap that does NOT take the lifecycle lock.
//
// stopServer() queues behind whatever holds that lock, and a start holds it for
// as long as the sidecar is still coming up. On quit that means the polite stop
// can lose its race and the app exits with a python still importing, which then
// binds the port with nobody supervising it — the exact orphan the quit drain
// exists to prevent. This kills what we have a handle on and whatever holds the
// port, and is only for the path where stopServer() has already timed out.
export async function forceReapServer(): Promise<void> {
  const proc = serverProcess;
  if (proc) {
    _stopRequested = true; // the death is ours; don't report it as a crash
    killTree(proc, 'SIGKILL');
  }
  serverStarted = false;
  await killProcessOnPort(serverPort);
  if (serverProcess === proc) serverProcess = null;
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
  /** Which kind of failure `lastError` describes, so the renderer can explain
   *  it without parsing the message. Null when there is no failure. */
  lastErrorKind: ServerStartErrorKind | null;
  /** PID found holding the port after the last failed start, or null when the
   *  port was free (the normal case). */
  portHolderPid: number | null;
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
    lastErrorKind: lastStartErrorKind,
    portHolderPid: lastPortHolderPid,
    lastExitCode,
    lastStartAt,
    recentLog: recentStderr,
    lastStopIntentional,
  };
}
