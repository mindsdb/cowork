// Run sibling source through uv in dev, or the installed cowork-server binary when packaged; await
// /health.

import { spawn, execFile, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { coworkHome, buildKind } from './cowork-home';
import { loadBundledServerCredentials } from './credential-provisioning';
import { MINDS_ENV_SLUG } from './minds-urls';
import { authHeader } from './server-auth';
import { withServerLifecycle } from './server-lifecycle';
import { decideStartWait, startFailureMessage } from './update-logic';
import { getEnvPath, resolveUv, coworkServerBinCandidates } from './uv-paths';
import {
  SERVER_START_CAP_MS,
  type ServerStartErrorKind,
} from '../shared/server-status';

const DEFAULT_PORT = 26866; // legacy port (ANTON on T9 keypad)
const SERVER_HOST = '127.0.0.1';
const DEV_OAUTH_ENV_FILE = path.join(os.homedir(), '.cowork-dev', '.env');

// Use per-user ports and verify the /health owner token before adoption.
// Loopback ports are machine-wide, so a port match alone could expose another OS user’s server.
const PORT_SPAN = 2000;

// Persist the owner token and pass COWORK_SERVER_OWNER; /health echoes it for adoption checks.
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
    // Protect the owner token with 0700/0600 permissions; another user who reads it could
    // impersonate our server.
    fs.mkdirSync(coworkHome(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tokenPath, token + '\n', { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(tokenPath, 0o600);
  } catch {
    // best-effort persistence; the token stays stable for this process at least
  }
  _ownerToken = token;
  return _ownerToken;
}

// Stable per-user, per-channel ports allow re-adopting our own orphan without sharing servers
// across builds.
// Dev/web use the proxy’s configured or fixed port instead.
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

let serverProcess: ChildProcess | null = null;
let serverPort: number = DEFAULT_PORT;
let serverStarted = false;
// Tracks an in-flight startServer() call so concurrent invocations
// share the same promise instead of spawning duplicate python processes
// (which would race for the same port and the second would fail).
let pendingStart: Promise<StartServerResult> | null = null;

/** Hold maintenance scope from source inspection through install/start/stop and verification. */
export async function withServerMaintenance<T>(fn: () => Promise<T>): Promise<T> {
  return withServerLifecycle(fn);
}

// Keep the last startup failure and a bounded stdout/stderr tail for backend diagnostics.
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
// Stop attribution: true for intentional stop, false for unexpected death, null before the first
// stop.
let lastStopIntentional: boolean | null = null;
// Set true while stopServer() is running so the child's exit event
// can attribute the death correctly. Reset to false in the exit
// handler.
let _stopRequested = false;

function appendStderr(chunk: string) {
  recentStderr = (recentStderr + chunk).slice(-STDERR_BUFFER_BYTES);
}

/*
 * Rotate one prior session log before each start; relaunching after a failure must not erase its
 * evidence.
 */
let logStream: fs.WriteStream | null = null;

export function getServerLogPath(): string {
  /*
   * Isolate non-prod logs under their channel homes; shared Electron log paths would overwrite
   * another build’s log.
   * This getter is pure; openLogStream creates the directory.
   */
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
    try {
      fs.renameSync(logPath, `${logPath}.1`);
    } catch {
      /* First launch, or a locked file — rotation is best-effort and must
         never keep the fresh log (or the spawn) from happening. */
    }
    const stream = fs.createWriteStream(logPath, { flags: 'w' });
    /*
     * Handle asynchronous stream-open errors; try/catch alone cannot prevent an unhandled error
     * crashing main.
     * Disk logs are best-effort; retain the in-memory tail.
     */
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

// Kill the entire tree: POSIX process groups or Windows taskkill /T. Killing only uv leaves Python
// orphaned.
// Windows uses /F even during the graceful phase because this GUI/shim launch cannot deliver
// console signals.
// Hard kills can lose an in-flight turn’s final persistence; graceful cancellation requires a
// separate handshake.
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
    // Parse netstat listeners using the zero peer address and final PID column.
    // Localized state names can span multiple words, so neither their text nor a fixed PID index is
    // reliable.
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

// Best-effort reap of port listeners when no ChildProcess handle survives.
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

// Poll quickly to detect readiness; allow each health request enough time on slow machines.
const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_PROBE_TIMEOUT_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read owner and required capabilities as well as health; older sidecars can be healthy but lack
// feature routes.
type HealthProbe = { state: 'unreachable' | 'compatible' | 'incompatible'; owner: string | null };

function probeHealthOnce(port: number, timeoutMs: number): Promise<HealthProbe> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: SERVER_HOST, port, path: '/api/v1/health/', timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve({ state: 'unreachable', owner: null }); return; }
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let owner: string | null = null;
          let supportsCoding = false;
          try {
            const payload = JSON.parse(body) as { owner?: string; capabilities?: unknown } | null;
            owner = payload?.owner ?? null;
            supportsCoding = Array.isArray(payload?.capabilities) && payload.capabilities.includes('coding');
          } catch { /* non-JSON */ }
          resolve({ state: supportsCoding ? 'compatible' : 'incompatible', owner });
        });
      },
    );
    req.on('error', () => resolve({ state: 'unreachable', owner: null }));
    req.on('timeout', () => { req.destroy(); resolve({ state: 'unreachable', owner: null }); });
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

// Read both backend versions in one health request for the unified About version.
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

// Resolve before creating the window so the renderer receives the selected port.
// Adopt only matching owners; route around foreign servers and fall back to the preferred port on
// probe failure.
export async function resolveServerPort(): Promise<number> {
  if (_portResolved || serverStarted) return serverPort;
  try {
    // A dev/web/test override pins the port (and matches the Vite proxy).
    const explicit = Number(process.env.COWORK_SERVER_PORT) || Number(process.env.ANTON_SERVER_PORT) || 0;
    if (explicit) { serverPort = explicit; return serverPort; }

    const preferred = app.isPackaged ? preferredServerPort() : DEFAULT_PORT;
    serverPort = preferred;

    const probe = await probeHealthOnce(preferred, 700);
    if (probe.owner && probe.owner !== serverOwnerToken()) {
      // Owned by a DIFFERENT install (another OS user) — never adopt or touch
      // it, compatible or not: reaping it would fail with EPERM and the spawn
      // with EADDRINUSE. Move to a free port we can own.
      const free = await findFreePort();
      if (free) serverPort = free;
      console.log(`[server] port ${preferred} held by a foreign server; using ${serverPort} instead`);
    } else if (probe.state === 'compatible' && probe.owner) {
      _adoptPlanned = true; // our own orphan — startServer will re-verify + adopt
    }
    // Keep the preferred port for unhealthy/old listeners so startup can reap and replace them.
    // A different OS user’s process cannot be killed; bind failure is safer than adopting it.
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

/**
 * Run after every successful start so the sidecar receives its in-memory credential.
 * Register from index.ts to avoid a cycle through minds-credential.
 */
let _startedHook: (() => Promise<unknown>) | null = null;

export function setServerStartedHook(hook: (() => Promise<unknown>) | null): void {
  _startedHook = hook;
}

export async function startServer(opts: { port?: number; readyTimeoutMs?: number } = {}): Promise<StartServerResult> {
  const result = await withServerLifecycle(() => startServerUnlocked(opts));
  /*
   * Await the handoff before startServer resolves and callers read readiness.
   * Top-level starts release the lifecycle lock first; a nested maintenance transaction still holds
   * its outer scope.
   */
  if (result.ok && _startedHook) {
    try {
      await _startedHook();
    } catch (error) {
      // A start that worked is still a start. The hook reports its own failures.
      console.warn('[server] post-start hook failed', error);
    }
  }
  return result;
}

async function startServerUnlocked(opts: { port?: number; readyTimeoutMs?: number }): Promise<StartServerResult> {
  if (serverStarted) {
    // Re-probe adopted processes: no child exit event exists to invalidate cached readiness.
    if (!_adoptedExternal) return { ok: true, port: serverPort };
    const probe = await probeHealthOnce(serverPort, 700);
    if (probe.state === 'compatible' && probe.owner === serverOwnerToken()) {
      return { ok: true, port: serverPort };
    }
    console.warn(`[server] adopted instance on port ${serverPort} is no longer healthy; starting a replacement`);
    await stopServerUnlocked();
  }
  // If a start is already in progress (e.g. from app boot), reuse it
  // instead of spawning a second python that would clash on the port.
  if (pendingStart) return pendingStart;

  // Resolve the per-user port and ownership before startup unless the caller pins a port.
  if (opts.port) {
    serverPort = opts.port;
  } else {
    await resolveServerPort();
  }

  // Re-verify ownership before adopting a healthy orphan from a prior session.
  if (_adoptPlanned || opts.port) {
    const probe = await probeHealthOnce(serverPort, 700);
    if (probe.state === 'compatible' && probe.owner && probe.owner === serverOwnerToken()) {
      serverStarted = true;
      _adoptedExternal = true;
      lastStartError = null;
      lastStartErrorKind = null;
      lastPortHolderPid = null;
      console.log(`[server] adopted our own existing instance on port ${serverPort}`);
      return { ok: true, port: serverPort };
    }
  }

  // Reap an unresponsive listener before spawning so a stale process cannot retain the port.
  const reaped = await killProcessOnPort(serverPort);
  if (reaped.length > 0) {
    console.log(`[server] reaped an orphan holding port ${serverPort} before spawn (pid ${reaped.join(', ')})`);
    await sleep(500);
  }

  // Use one startup cap in every build; a dev-only allowance would hide slow-start failures from
  // local testing.
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
  // Reset prior stop attribution so this start cycle reports its own exit cause.
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
    const uvCmd = await resolveUv();
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
    // Share the channel config home with the sidecar. Leave prod unset to preserve its legacy
    // ~/.anton fallback.
    // Setting COWORK_HOME explicitly disables that server fallback.
    const kind = buildKind();
    const dataHome = coworkHome();
    console.log(`[server] build kind "${kind}" → data home ${dataHome}`);
    const env = {
      ...process.env,
      ...(await loadBundledServerCredentials()),
      // Pass only the dev OAuth file path; the sidecar parses allowed fields so secrets do not
      // enter Electron’s env/logs.
      ...(!app.isPackaged ? { COWORK_DEV_OAUTH_ENV_FILE: DEV_OAUTH_ENV_FILE } : {}),
      PATH: getEnvPath(),
      PYTHONUNBUFFERED: '1',
      // Set both supported port aliases. Default Python to UTF-8 across child processes, preserving
      // explicit overrides.
      // Do not set PYTHONIOENCODING: a bare value would replace surrogateescape with strict stdio
      // handling.
      PYTHONUTF8: process.env.PYTHONUTF8 || '1',
      COWORK_SERVER_PORT: String(serverPort),
      COWORK_LISTEN_PORT: String(serverPort),
      COWORK_SERVER_HOST: SERVER_HOST,
      // Set server_origin to the resolved port so OAuth redirects do not target the historical
      // fixed port.
      COWORK_SERVER_ORIGIN: getServerOrigin(),
      ...(kind !== 'prod' ? { COWORK_HOME: dataHome } : {}),
      // ENG-439: stamp the server we spawn with our owner token so a future
      // launch (ours) can tell this server is ours and adopt it, while another
      // OS user's app sees a mismatch and never adopts it.
      COWORK_SERVER_OWNER: serverOwnerToken(),
      // Pass non-prod ENV to align server defaults, preserving any operator override.
      ...(MINDS_ENV_SLUG && !process.env.ENV ? { ENV: MINDS_ENV_SLUG } : {}),
    };

    // Use a POSIX process group so termination reaches uv’s Python descendants.
    openLogStream();

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: spawnCwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    child.stdout.on('data', (d) => {
      const text = d.toString();
      // Capture both streams: Python tracebacks use stderr, while logged errors can arrive on
      // stdout.
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

    // Handle spawn errors explicitly: a process that never starts emits no output or exit event.
    // Without a listener Node would also raise the error as uncaught.
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
      // Attribute exits to stopServer only when requested; otherwise show failure diagnostics.
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

    // Poll while the child is alive, stopping immediately on death or at the startup cap.
    const waitStartedAt = Date.now();
    let step = decideStartWait({ healthy: false, spawnError, exited: childExited, elapsedMs: 0, capMs: startCapMs });
    while (step.action === 'poll') {
      await sleep(HEALTH_POLL_INTERVAL_MS);
      const probe = await probeHealthOnce(serverPort, HEALTH_PROBE_TIMEOUT_MS);
      step = decideStartWait({
        healthy: probe.state === 'compatible',
        incompatible: probe.state === 'incompatible',
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
      // Reap failed starts so they cannot keep the port; escalate from termination to kill if
      // necessary.
      // Skip when spawn itself failed, because no process or exit event exists.
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
    // If health is live after the launcher exits, track the sidecar as adopted and stop it by port.
    if (childExited) _adoptedExternal = true;
    // Log successful startup duration as well as failures so near-cap boots remain diagnosable.
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

// Wait for exit before clearing the slot or a restart can race a still-bound port.
// Allow 6s for shutdown (the sidecar’s channel drain alone budgets 3s), then 1.5s for hard kill.
// Clear the slot after the cap so shutdown cannot block quit forever.
export async function stopServer(): Promise<void> {
  return withServerLifecycle(stopServerUnlocked);
}

async function prepareCodingTasksForShutdown(): Promise<void> {
  if (!serverStarted) return;
  try {
    const response = await fetch(`${getServerOrigin()}/api/v1/coding/runtime/prepare-shutdown`, {
      method: 'POST',
      headers: authHeader(),
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      console.warn(`[coding] shutdown checkpoint returned HTTP ${response.status}`);
    }
  } catch (error) {
    // The sidecar may already be unhealthy. Continue with the bounded process
    // teardown; its startup reconciliation remains the crash-safety fallback.
    console.warn('[coding] could not checkpoint active tasks before shutdown', error);
  }
}

async function stopServerUnlocked(): Promise<void> {
  // Allow the next start to re-resolve the port (re-derive the per-user port
  // and re-check whether anything is running there). ENG-439.
  _portResolved = false;
  const proc = serverProcess;
  if (!proc) {
    if (_adoptedExternal) await prepareCodingTasksForShutdown();
    serverStarted = false;
    lastStopIntentional = true;
    // Adopted processes have no child handle; reap their port listener on stop.
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
  await prepareCodingTasksForShutdown();
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

  // Clear only the same child’s slot so a concurrent replacement is not forgotten.
  if (serverProcess === proc) {
    serverProcess = null;
  }
}

// Last-resort quit reap bypasses the lifecycle lock after stopServer times out.
// A slow startup may still hold that lock while its Python process imports and later binds the
// port.
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

// Require confirmed health and a live child when supervised; adopted servers use the cached started
// flag.
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
   * Intentional stop=true, unexpected exit=false, no stop yet=null; selects the renderer’s
   * diagnostic treatment.
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
