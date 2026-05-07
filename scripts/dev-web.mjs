// `npm run dev:web` orchestrator.
//
// Boots the Anton FastAPI sidecar first, waits for /health, then boots
// Vite. Mirrors how Electron starts its python sidecar before mounting
// the renderer — the developer doesn't have to start the server in a
// second terminal and watch a wall of ECONNREFUSED scroll past.
//
// Stdlib + ./start-server.mjs only. No `concurrently`, no new deps.

import { spawn } from 'node:child_process';
import { start, stop, onUnexpectedExit, SERVER_PORT } from './start-server.mjs';

const READY_TIMEOUT_MS = 15000;

let viteChild = null;
let shuttingDown = false;

async function main() {
  process.stdout.write(`⧖ Waiting for Anton server on :${SERVER_PORT}…`);

  // Heartbeat: one dot per 500ms while we wait for /health. Health
  // probes run every 250ms inside start-server.mjs; emitting one dot
  // per two probes keeps the output calm.
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
  console.log(`✓ Anton server ready on :${SERVER_PORT}`);

  // Bail loudly if the server dies after we've handed off to Vite.
  // We don't auto-restart — let the developer re-run.
  onUnexpectedExit((code) => {
    if (shuttingDown) return;
    console.error(`✗ Anton server exited unexpectedly (code ${code}). Re-run \`npm run dev:web\`.`);
    if (viteChild) { try { viteChild.kill('SIGTERM'); } catch {} }
    process.exit(1);
  });

  // Boot Vite. inherit stdio so HMR output, error overlays, and the
  // "press q to quit" hint render the way developers expect.
  // BUILD_TARGET=web activates the cowork-web-root-rewrite middleware
  // in vite.config.ts which maps `/` to `/index-web.html` — so the
  // bare URL is the canonical one.
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
    // Vite exited on its own (e.g. user pressed `q`). Mirror its exit
    // code, but tear down the python child first.
    shuttingDown = true;
    stop();
    process.exit(code ?? 0);
  });
}

async function shutdown() {
  if (shuttingDown) {
    // Second Ctrl-C: force-exit. Don't wait for graceful shutdown.
    console.error('\n✗ Force-quit.');
    if (viteChild) { try { viteChild.kill('SIGKILL'); } catch {} }
    stop();
    process.exit(130);
  }
  shuttingDown = true;

  // Order: vite first, then python. Vite (in our process group) gets
  // its own SIGINT directly from the terminal and starts shutting down;
  // we wait for it to fully exit, THEN SIGTERM the (detached) python.
  // This avoids a window where vite is still proxying /v1/* into a
  // dying python and the terminal fills with ECONNREFUSED.
  if (viteChild && viteChild.exitCode === null) {
    try { viteChild.kill('SIGTERM'); } catch {}
    await new Promise((resolve) => {
      viteChild.once('exit', resolve);
      // Don't wait forever if vite hangs — 5s is generous.
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
