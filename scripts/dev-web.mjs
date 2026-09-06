// Start cowork-server and wait for health before Vite can proxy requests.

import { spawn } from 'node:child_process';
import { start, stop, onUnexpectedExit, SERVER_PORT } from './start-server.mjs';

const READY_TIMEOUT_MS = 15000;

let viteChild = null;
let shuttingDown = false;

async function main() {
  process.stdout.write(`⧖ Waiting for cowork-server on :${SERVER_PORT}…`);

  const heartbeat = setInterval(() => process.stdout.write('.'), 500);

  try {
    await start({ readyTimeoutMs: READY_TIMEOUT_MS });
  } catch (err) {
    clearInterval(heartbeat);
    process.stdout.write('\n');
    console.error(`✗ ${err?.message || err}`);
    process.exit(1);
  }
  clearInterval(heartbeat);
  process.stdout.write('\n');
  console.log(`✓ cowork-server ready on :${SERVER_PORT}`);

  // Exit on server death so Vite cannot continue proxying into a dead backend.
  onUnexpectedExit((code) => {
    if (shuttingDown) return;
    console.error(`✗ cowork-server exited unexpectedly (code ${code}). Re-run \`npm run dev:web\`.`);
    if (viteChild) { try { viteChild.kill('SIGTERM'); } catch {} }
    process.exit(1);
  });

  // BUILD_TARGET=web enables Vite's / to index-web.html rewrite.
  viteChild = spawn(
    'npx',
    ['vite', 'dev', 'src/renderer', '--open', '/'],
    {
      stdio: 'inherit',
      env: { ...process.env, BUILD_TARGET: 'web' },
    },
  );

  viteChild.on('exit', async (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stop();
    process.exit(code ?? 0);
  });
}

async function shutdown() {
  if (shuttingDown) {
    console.error('\n✗ Force-quit.');
    if (viteChild) { try { viteChild.kill('SIGKILL'); } catch {} }
    stop();
    process.exit(130);
  }
  shuttingDown = true;

  // Stop Vite before the detached server so shutdown cannot leave the proxy hitting a dying
  // backend.
  if (viteChild && viteChild.exitCode === null) {
    try { viteChild.kill('SIGTERM'); } catch {}
    await new Promise((resolve) => {
      viteChild.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
  }
  stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error(`✗ ${err?.message || err}`);
  stop();
  process.exit(1);
});
