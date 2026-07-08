#!/usr/bin/env node
// Dev launcher for the Electron main process.
//
// The renderer learns its environment (dev / staging / prod) from `.env` via
// Vite (VITE_MINDS_API_URL / VITE_KEYCLOAK_URL). The main process is compiled
// with plain `tsc` and CANNOT see VITE_ vars, so it reads MINDS_API_HOST /
// baked BUILD_MINDS_API_URL and otherwise falls back to the prod default
// (see src/main/minds-urls.ts). Under a bare `npm run dev` nothing sets those,
// so the renderer points at dev while the main process (which owns the sign-in
// loopback) points at prod — a split-brain where registration/console links go
// to one environment and login goes to another.
//
// This wrapper bridges the gap: it reads VITE_MINDS_API_URL from the
// environment (or `.env`) and passes it to the main process as MINDS_API_HOST,
// so both halves resolve to the same environment in dev. An explicit
// MINDS_API_HOST (e.g. exported by the parent-repo Makefile) still wins.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal `.env` reader — avoids a dotenv dependency for one value. Returns ''
// when the file or key is absent. An already-exported process env wins.
function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  try {
    const text = readFileSync(join(ROOT, '.env'), 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env in this checkout — fall through to prod default */
  }
  return '';
}

// The main process reads MINDS_API_HOST; the renderer reads VITE_MINDS_API_URL.
// They carry the same value, so bridge one to the other.
const apiHost = process.env.MINDS_API_HOST || readEnvVar('VITE_MINDS_API_URL');

const env = { ...process.env, VITE_DEV: '1' };
if (apiHost) env.MINDS_API_HOST = apiHost;

console.log(
  `[dev-electron] MINDS_API_HOST=${apiHost || '(prod default)'}` +
    `${env.ANTON_OPEN_DEVTOOLS ? ' devtools=on' : ''}`,
);

const child = spawn('electron', ['dist/main/main/index.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
