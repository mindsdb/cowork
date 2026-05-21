// Standalone cowork-server spawn — used by `npm run dev:web` to boot
// the FastAPI backend alongside Vite. Uses `uv run python -m cowork`
// from the cowork-server sibling directory, which lets uv manage the
// virtualenv and dependencies automatically.
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
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_PORT = 26866; // ANTON on T9 keypad
const SERVER_HOST = '127.0.0.1';

let serverProcess = null;
let serverStarted = false;

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

async function probeHealth(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(
        { hostname: SERVER_HOST, port, path: '/health', timeout: 1000 },
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
  return false;
}

export const SERVER_PORT = DEFAULT_PORT;

export async function start({ readyTimeoutMs = 15000 } = {}) {
  if (serverStarted) return { port: DEFAULT_PORT };

  const serverDir = getServerDir();
  if (!fs.existsSync(path.join(serverDir, 'pyproject.toml'))) {
    process.stderr.write('\n');
    console.error(`✗ cowork-server not found at ${serverDir}.`);
    console.error('  Expected a sibling directory ../cowork-server with pyproject.toml.');
    console.error('  Set COWORK_SERVER_DIR to override.');
    process.exit(1);
  }

  const uvCmd = getUvPath();

  const env = {
    ...process.env,
    PATH: getEnvPath(),
    PYTHONUNBUFFERED: '1',
    COWORK_SERVER_PORT: String(DEFAULT_PORT),
    COWORK_SERVER_HOST: SERVER_HOST,
  };

  // detached:true puts the python in its own process group so the
  // terminal's SIGINT (from Ctrl-C) doesn't reach it directly. dev-web.mjs
  // controls shutdown order explicitly: vite quiesces first, THEN we
  // SIGTERM python — avoids ECONNREFUSED noise from vite proxying
  // /v1/* during shutdown.
  const child = spawn(uvCmd, ['run', 'cowork-server'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.stdout.on('data', (d) => {
    process.stdout.write(`[cowork-server] ${d.toString()}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[cowork-server] ${d.toString()}`);
  });
  child.on('exit', (code) => {
    serverStarted = false;
    serverProcess = null;
    if (code !== 0 && code !== null) {
      console.error(`[cowork-server] exited with code ${code}`);
    }
  });

  serverProcess = child;

  const ready = await probeHealth(DEFAULT_PORT, readyTimeoutMs);
  if (!ready) {
    try { child.kill('SIGTERM'); } catch {}
    throw new Error(`Server did not respond on /health within ${readyTimeoutMs}ms.`);
  }
  serverStarted = true;
  return { port: DEFAULT_PORT };
}

export function stop() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
    serverProcess = null;
    serverStarted = false;
  }
}

export function isRunning() {
  return serverStarted && serverProcess !== null;
}

export function onUnexpectedExit(cb) {
  // Fires when the server child dies AFTER a successful start.
  // Used by dev-web.mjs to fail loudly instead of leaving Vite proxying
  // into the void.
  if (!serverProcess) return;
  const handler = (code) => {
    if (serverStarted) cb(code);
  };
  serverProcess.once('exit', handler);
}
