// Standalone Anton FastAPI server spawn — used by `npm run dev:web` to
// boot the python sidecar alongside Vite, so a developer who already
// has anton installed (`uv tool install anton`) doesn't have to start
// it in a second terminal.
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

function getAntonPython() {
  const dataHome = process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming' : '.local/share');
  const candidate = path.join(
    dataHome, 'uv', 'tools', 'anton',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return fs.existsSync(candidate) ? candidate : null;
}

// Prepend ~/.local/bin and ~/.cargo/bin so the spawned server can find
// `uv` (anton's scratchpad runtime calls `shutil.which("uv")` for fast
// venv creation). Important for any launch context where shell init
// files aren't read.
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

  const pythonCmd = getAntonPython();
  if (!pythonCmd) {
    const expected = path.join(
      process.env.XDG_DATA_HOME ||
        path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Roaming' : '.local/share'),
      'uv', 'tools', 'anton',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    process.stderr.write('\n');
    console.error(`✗ Anton Python interpreter not found at ${expected}.`);
    console.error('  Run `uv tool install anton` first, then re-run `npm run dev:web`.');
    process.exit(1);
  }

  const serverDir = path.resolve('./server');
  if (!fs.existsSync(path.join(serverDir, 'main.py'))) {
    throw new Error(`Server source not found at ${serverDir}/main.py (expected to run from cowork repo root).`);
  }

  // We deliberately don't set ANTON_PROJECTS_DIR. The server uses
  // ~/.anton/* defaults, which shares vault and settings with anton CLI
  // naturally. Note this is NOT the same path as the Electron app uses
  // for projects — Electron stores projects at app.getPath('userData')
  // (e.g. ~/Library/Application Support/Anton/projects on macOS), which
  // is intentionally Electron-isolated. If a developer wants dev:web
  // to share projects with the Electron app specifically, they can:
  //
  //   ANTON_PROJECTS_DIR="$HOME/Library/Application Support/Anton/projects" npm run dev:web
  //
  // Vault and settings (~/.anton/.env, ~/.anton/data_vault) are always
  // shared with anton CLI regardless.
  const env = {
    ...process.env,
    PATH: getEnvPath(),
    PYTHONUNBUFFERED: '1',
    ANTON_SERVER_PORT: String(DEFAULT_PORT),
    ANTON_SERVER_HOST: SERVER_HOST,
  };

  // detached:true puts the python in its own process group so the
  // terminal's SIGINT (from Ctrl-C) doesn't reach it directly. dev-web.mjs
  // controls shutdown order explicitly: vite quiesces first, THEN we
  // SIGTERM python — avoids ECONNREFUSED noise from vite proxying
  // /v1/* during shutdown.
  const child = spawn(pythonCmd, ['main.py'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  child.stdout.on('data', (d) => {
    process.stdout.write(`[anton-server] ${d.toString()}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[anton-server] ${d.toString()}`);
  });
  child.on('exit', (code) => {
    serverStarted = false;
    serverProcess = null;
    if (code !== 0 && code !== null) {
      console.error(`[anton-server] exited with code ${code}`);
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
