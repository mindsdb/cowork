// Standalone cowork-server spawn, used by `npm run dev:web` (dev-web.mjs,
// its only caller) to boot the FastAPI backend alongside Vite. Uses
// `uv run cowork-server` from the cowork-server sibling directory, which lets
// uv manage the virtualenv and dependencies automatically.
//
// Mirrors src/main/server-process.ts intentionally. We accept the small
// duplication: server-process.ts is electron-coupled (uses app.isPackaged,
// app.getPath('userData'), and a 32 KB stderr ring buffer for the
// "why is the backend offline?" diagnostics modal) and trying to share
// via a common module would force awkward imports across the
// main/renderer boundary. The spawn logic is small and stable.
//
// Stdlib only — no electron, no npm deps.

import { spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_PORT = 26866; // ANTON on T9 keypad
const SERVER_HOST = '127.0.0.1';

let serverProcess = null;
let serverStarted = false;
/** The running server's hand-off (newLaunchHandoff), or null before a start. */
let launch = null;
/** The callback onUnexpectedExit registered for the running server, or null. */
let unexpectedExitCallback = null;

/* The launch contract, as src/shared/server-launch.ts holds it for desktop
   main: the stdin flag, the protocol, and the hand-off line with its keys
   app_secret, auth_token and window_proof (launchStdinLine below). This
   script cannot import TypeScript, so it keeps a copy, and
   src/shared/server-launch.test.ts pins the two equal. cowork-server's
   cowork/app_secret.py mirrors the same values. */
export const STDIN_FLAG = 'COWORK_APP_SECRET_STDIN';
export const HANDOFF_PROTOCOL = 2;
/* The /health challenge header, as APP_CHALLENGE_HEADER in
   src/main/app-secret.ts holds it (cowork-server's CHALLENGE_HEADER).
   src/main/dev-server-launch.test.ts pins the two equal. */
export const APP_CHALLENGE_HEADER = 'X-Cowork-App-Challenge';

/** Fresh values for one launch, as desktop main makes them: the app secret,
 *  the bearer token and the window proof, each 32 random bytes in hex. */
export function newLaunchHandoff() {
  const hex = () => randomBytes(32).toString('hex');
  return { appSecret: hex(), authToken: hex(), windowProof: hex() };
}

/** The one stdin line the server reads at startup: a JSON object with exactly
 *  the keys app_secret, auth_token and window_proof. */
export function launchStdinLine(handoff) {
  return `${JSON.stringify({
    app_secret: handoff.appSecret,
    auth_token: handoff.authToken,
    window_proof: handoff.windowProof,
  })}\n`;
}

// The non-production PostHog project (NON_PROD_POSTHOG_KEY in
// src/main/analytics-env.ts; a test keeps the two equal). Without these, anton
// in a dev server reports its turns to production with no `environment`.
const NON_PROD_POSTHOG_KEY = 'phc_zBzpZzh8kCPVpKeVyRRLNSfyTisRfLCq8SPhtiTHZway';

/** A dev server's turns are ours: send them to the non-production project,
 *  labelled `dev`, as the desktop app does for its dev kind. A variable the
 *  developer set, exported or in a dotenv file that reaches anton
 *  (`dotenvNames`), is left alone, even an empty one: anton's documented way
 *  to switch the sink off is `ANTON_POSTHOG_KEY=` in such a file, and a
 *  spawned value would outrank it. */
export function devAnalyticsEnv(env = process.env, dotenvNames = new Set()) {
  const isSet = (name) => env[name] !== undefined || dotenvNames.has(name);
  const out = {};
  if (!isSet('ANTON_POSTHOG_KEY')) out.ANTON_POSTHOG_KEY = NON_PROD_POSTHOG_KEY;
  if (!isSet('ANTON_DEPLOYMENT_ENV')) out.ANTON_DEPLOYMENT_ENV = 'dev';
  return out;
}

/** The `.env` cowork-server's own `load_dotenv()` loads into the environment
 *  anton then reads: python-dotenv walks up from the calling module
 *  (`cowork/cli.py`) and takes the first `.env` it finds, so with none in the
 *  server dir it is a parent folder's. Undefined when there is none. */
export function coworkServerDotenv(serverDir) {
  let dir = path.join(serverDir, 'cowork');
  for (;;) {
    const file = path.join(dir, '.env');
    if (fs.existsSync(file)) return file;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The names assigned in the dotenv files that reach anton for a server
 *  running in `serverDir`, upper-cased: the ones anton reads itself (`.env`
 *  and `.anton/.env` there, then `~/.anton/.env` and `~/.cowork/.env`), and
 *  the one cowork-server loads (`coworkServerDotenv`). A line match, not
 *  python-dotenv's full grammar (src/main/analytics-env.ts has that), which
 *  is enough for a dev script. */
export function antonDotenvNames(serverDir, home = os.homedir()) {
  const files = new Set([
    path.join(serverDir, '.env'),
    path.join(serverDir, '.anton', '.env'),
    path.join(home, '.anton', '.env'),
    path.join(home, '.cowork', '.env'),
  ]);
  const loaded = coworkServerDotenv(serverDir);
  if (loaded) files.add(loaded);
  const names = new Set();
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*=/);
      if (m) names.add(m[1].toUpperCase());
    }
  }
  return names;
}

// Locate the cowork-server directory. Convention: sibling of this repo
// (../cowork-server relative to the cowork repo root). Override with
// COWORK_SERVER_DIR env var for non-standard layouts.
function getServerDir() {
  if (process.env.COWORK_SERVER_DIR) {
    return path.resolve(process.env.COWORK_SERVER_DIR);
  }
  return path.resolve('..', 'cowork-server');
}

function getUvPath() {
  const localBin = path.join(os.homedir(), '.local', 'bin', 'uv');
  if (fs.existsSync(localBin)) return localBin;
  // Fall back to PATH lookup
  return 'uv';
}

// Prepend ~/.local/bin and ~/.cargo/bin so the spawned server can find
// `uv` and other tools. Important for any launch context where shell
// init files aren't read.
function getEnvPath() {
  const localBin = path.join(os.homedir(), '.local', 'bin');
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const currentPath = process.env.PATH || '';
  const parts = [localBin, cargoBin, currentPath].filter(Boolean);
  return parts.join(path.delimiter);
}

/** Whether a /health answer proves it holds `appSecret`: it reports
 *  HANDOFF_PROTOCOL, and its app_secret_proof is the hex HMAC-SHA256 of
 *  `challenge` under the secret. judgeServer in src/main/app-secret.ts makes
 *  the same check for desktop main, and proof() in cowork-server's
 *  cowork/app_secret.py computes it. */
function provesAppSecret(payload, appSecret, challenge) {
  const proof = payload?.app_secret_proof;
  if (payload?.app_secret_protocol !== HANDOFF_PROTOCOL || typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
  const expected = createHmac('sha256', appSecret).update(challenge).digest();
  return timingSafeEqual(expected, Buffer.from(proof, 'hex'));
}

/** One /health probe with a fresh challenge. Resolves 'ready' when the answer
 *  proves `appSecret`, 'foreign' for any other answer, and 'down' when nothing
 *  answers. Only the server this launch started holds the app secret, so an
 *  answer without the proof comes from something else on the port. */
function probeHealthOnce(port, appSecret) {
  const challenge = randomBytes(32).toString('hex');
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: SERVER_HOST, port, path: '/api/v1/health/', timeout: 1000, headers: { [APP_CHALLENGE_HEADER]: challenge } },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve('down'); return; }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          let payload = null;
          try { payload = JSON.parse(body); } catch { /* not JSON: not our server */ }
          resolve(provesAppSecret(payload, appSecret, challenge) ? 'ready' : 'foreign');
        });
      },
    );
    req.on('error', () => resolve('down'));
    req.on('timeout', () => { req.destroy(); resolve('down'); });
  });
}

/** Polls /health until the server this launch started answers with the proof,
 *  racing every probe and pause against the child's exit. Resolves 'ready',
 *  'foreign' (an answer without the proof), 'exited' (the child exited first),
 *  or 'down' (nothing answered within `timeoutMs`). */
async function waitForServer(port, timeoutMs, appSecret, exited) {
  const exit = exited.then(() => 'exited');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await Promise.race([probeHealthOnce(port, appSecret), exit]);
    if (state !== 'down') return state;
    const paused = await Promise.race([new Promise((r) => setTimeout(r, 250)), exit]);
    if (paused === 'exited') return 'exited';
  }
  return 'down';
}

/** Why start() failed, for a wait that ended in `state`. */
function startFailure(state, { serverDir, readyTimeoutMs, exit }) {
  if (state === 'foreign') {
    return `Something else holds :${DEFAULT_PORT}: it answered /health without proving it holds the app secret this launch handed its server. `
      + `Stop it, for example a cowork-server started from a terminal or another dev:web, and re-run. `
      + `If nothing else runs there, ${serverDir} predates the launch hand-off (app_secret_protocol ${HANDOFF_PROTOCOL}).`;
  }
  if (state === 'exited') {
    const how = typeof exit?.code === 'number' ? `code ${exit.code}` : `signal ${exit?.signal ?? 'unknown'}`;
    return `cowork-server exited (${how}) before it answered /health on :${DEFAULT_PORT}. Its output above names the cause.`;
  }
  return `Server did not respond on /health within ${readyTimeoutMs}ms.`;
}

export const SERVER_PORT = DEFAULT_PORT;

/** Starts the server and resolves with its port and the bearer token and
 *  window proof it was handed, which dev-web.mjs passes to Vite's /api proxy. */
export async function start({ readyTimeoutMs = 15000 } = {}) {
  if (serverStarted) return { port: DEFAULT_PORT, authToken: launch.authToken, windowProof: launch.windowProof };

  const serverDir = getServerDir();
  if (!fs.existsSync(path.join(serverDir, 'pyproject.toml'))) {
    process.stderr.write('\n');
    console.error(`✗ cowork-server not found at ${serverDir}.`);
    console.error('  Expected a sibling directory ../cowork-server with pyproject.toml.');
    console.error('  Set COWORK_SERVER_DIR to override.');
    process.exit(1);
  }

  const uvCmd = getUvPath();

  /* The bearer token reaches the server on stdin only, as server-process.ts
     hands it over, so an inherited COWORK_AUTH_TOKEN stays out of its env. */
  const { COWORK_AUTH_TOKEN: _inheritedToken, ...inheritedEnv } = process.env;
  const env = {
    ...inheritedEnv,
    ...devAnalyticsEnv(process.env, antonDotenvNames(serverDir)),
    PATH: getEnvPath(),
    PYTHONUNBUFFERED: '1',
    // Pin the dev home; unset COWORK_HOME defaults to ~/.cowork (prod). Mirrors
    // server-process.ts, which the Electron dev path already does.
    COWORK_HOME: process.env.COWORK_HOME || path.join(os.homedir(), '.cowork-dev'),
    // Both port names — see server-process.ts spawn env for why.
    COWORK_SERVER_PORT: String(DEFAULT_PORT),
    COWORK_LISTEN_PORT: String(DEFAULT_PORT),
    COWORK_SERVER_HOST: SERVER_HOST,
    // The hand-off itself goes over stdin below; only the flag goes here.
    [STDIN_FLAG]: String(HANDOFF_PROTOCOL),
  };
  const handoff = newLaunchHandoff();

  // detached:true puts the python in its own process group so the
  // terminal's SIGINT (from Ctrl-C) doesn't reach it directly. dev-web.mjs
  // controls shutdown order explicitly: vite quiesces first, THEN we
  // SIGTERM python — avoids ECONNREFUSED noise from vite proxying
  // /v1/* during shutdown.
  const child = spawn(uvCmd, ['run', 'cowork-server'], {
    cwd: serverDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  let exit = null;
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => { exit = { code, signal }; resolve(); });
  });
  // One line, then EOF, so processes the server starts inherit a closed stdin.
  child.stdin.on('error', (err) => {
    console.error(`[cowork-server] could not write the launch hand-off: ${err.message}`);
  });
  child.stdin.end(launchStdinLine(handoff));

  child.stdout.on('data', (d) => {
    process.stdout.write(`[cowork-server] ${d.toString()}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[cowork-server] ${d.toString()}`);
  });
  child.on('exit', (code) => {
    /* Read before clearing: the server exited unasked when start() had
       resolved and stop() had not run, since stop() clears serverStarted. */
    const exitedUnasked = serverStarted;
    const callback = unexpectedExitCallback;
    serverStarted = false;
    serverProcess = null;
    unexpectedExitCallback = null;
    if (code !== 0 && code !== null) {
      console.error(`[cowork-server] exited with code ${code}`);
    }
    if (exitedUnasked && callback) callback(code);
  });

  serverProcess = child;

  const health = await waitForServer(DEFAULT_PORT, readyTimeoutMs, handoff.appSecret, exited);
  if (health !== 'ready') {
    stop();
    throw new Error(startFailure(health, { serverDir, readyTimeoutMs, exit }));
  }
  launch = handoff;
  serverStarted = true;
  return { port: DEFAULT_PORT, authToken: handoff.authToken, windowProof: handoff.windowProof };
}

export function stop() {
  if (serverProcess) {
    // Kill the entire process group (detached child + grandchildren)
    // so the Python server doesn't survive as an orphan holding the port.
    if (serverProcess.pid) {
      try { process.kill(-serverProcess.pid, 'SIGTERM'); } catch {}
    }
    try { serverProcess.kill('SIGTERM'); } catch {}
    serverProcess = null;
    serverStarted = false;
    launch = null;
    unexpectedExitCallback = null;
  }
}

/* Ensure the detached server process group is cleaned up if the parent exits
   (process.exit, a crash, an uncaught exception) or its terminal hangs up.
   SIGINT and SIGTERM are dev-web.mjs's: its shutdown closes Vite and only then
   calls stop(), and a handler here would stop the server first. */
for (const sig of ['exit', 'SIGHUP']) {
  process.on(sig, () => { stop(); });
}

export function isRunning() {
  return serverStarted && serverProcess !== null;
}

export function onUnexpectedExit(cb) {
  // Fires when the server child dies AFTER a successful start.
  // Used by dev-web.mjs to fail loudly instead of leaving Vite proxying
  // into the void. start()'s exit listener calls it.
  if (!serverProcess) return;
  unexpectedExitCallback = cb;
}
