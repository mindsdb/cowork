// Standalone dev-web sidecar. Keep separate from Electron-coupled server-process.ts so it runs
// without Electron.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_PORT = 26866;
const SERVER_HOST = '127.0.0.1';

let serverProcess = null;
let serverStarted = false;

// Find the sibling cowork-server checkout; COWORK_SERVER_DIR overrides the location.
function getServerDir() {
  if (process.env.COWORK_SERVER_DIR) {
    return path.resolve(process.env.COWORK_SERVER_DIR);
  }
  return path.resolve('..', 'cowork-server');
}

function getUvPath() {
  const localBin = path.join(os.homedir(), '.local', 'bin', 'uv');
  if (fs.existsSync(localBin)) return localBin;
  return 'uv';
}

// GUI/non-login launches may omit uv from PATH; prepend the standard local tool directories.
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
        { hostname: SERVER_HOST, port, path: '/api/v1/health/', timeout: 1000 },
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
    // Pin the dev home: an unset COWORK_HOME would use the production profile.
    COWORK_HOME: process.env.COWORK_HOME || path.join(os.homedir(), '.cowork-dev'),
    COWORK_SERVER_PORT: String(DEFAULT_PORT),
    COWORK_LISTEN_PORT: String(DEFAULT_PORT),
    COWORK_SERVER_HOST: SERVER_HOST,
  };

  // Detach the server process group so terminal SIGINT cannot bypass dev-web's Vite-first shutdown
  // order.
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
    // Kill the process group, including grandchildren, so no orphan retains the port.
    if (serverProcess.pid) {
      try { process.kill(-serverProcess.pid, 'SIGTERM'); } catch {}
    }
    try { serverProcess.kill('SIGTERM'); } catch {}
    serverProcess = null;
    serverStarted = false;
  }
}

for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { stop(); });
}

export function isRunning() {
  return serverStarted && serverProcess !== null;
}

export function onUnexpectedExit(cb) {
  // Notify dev-web if the server dies after startup so it can stop Vite.
  if (!serverProcess) return;
  const handler = (code) => {
    if (serverStarted) cb(code);
  };
  serverProcess.once('exit', handler);
}
