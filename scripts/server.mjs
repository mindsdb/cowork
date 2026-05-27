// `npm run server` wrapper. Resolves the in-repo .venv Python per-platform
// (Unix: .venv/bin/python, Windows: .venv\Scripts\python.exe) so the script
// works on both. Mirrors the venv layout `uv venv` and Python's `venv`
// module produce on each platform.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const venvPython = process.platform === 'win32'
  ? path.resolve('.venv/Scripts/python.exe')
  : path.resolve('.venv/bin/python');

if (!fs.existsSync(venvPython)) {
  console.error(`✗ Python interpreter not found at ${venvPython}.`);
  console.error('  Create the venv first (e.g. `uv venv` or `python -m venv .venv`).');
  process.exit(1);
}

const serverDir = path.resolve('server');
const child = spawn(venvPython, ['main.py'], {
  cwd: serverDir,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

const forward = (sig) => () => { try { child.kill(sig); } catch {} };
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));
