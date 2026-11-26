// `npm run dev:web` orchestrator.
//
// Boots the Anton FastAPI sidecar first, waits for /health, then boots
// Vite. Mirrors how Electron starts its python sidecar before mounting
// the renderer — the developer doesn't have to start the server in a
// second terminal and watch a wall of ECONNREFUSED scroll past.
//
// Stdlib, Vite, ./start-server.mjs and ./dev-web-vite.mjs only. No
// `concurrently`, no new deps.

import { createDevWebServer } from './dev-web-vite.mjs';
import { start, stop, onUnexpectedExit, SERVER_PORT } from './start-server.mjs';

const READY_TIMEOUT_MS = 15000;

let vite = null;
let shuttingDown = false;

async function main() {
  process.stdout.write(`⧖ Waiting for cowork-server on :${SERVER_PORT}…`);

  // Heartbeat: one dot per 500ms while we wait for /health. Health
  // probes run every 250ms inside start-server.mjs; emitting one dot
  // per two probes keeps the output calm.
  const heartbeat = setInterval(() => process.stdout.write('.'), 500);

  let launch;
  try {
    launch = await start({ readyTimeoutMs: READY_TIMEOUT_MS });
  } catch (err) {
    clearInterval(heartbeat);
    process.stdout.write('\n');
    console.error(`✗ ${err?.message || err}`);
    process.exit(1);
  }
  clearInterval(heartbeat);
  process.stdout.write('\n');
  console.log(`✓ cowork-server ready on :${SERVER_PORT}`);

  // Bail loudly if the server dies after we've handed off to Vite.
  // We don't auto-restart — let the developer re-run.
  onUnexpectedExit((code) => {
    if (shuttingDown) return;
    console.error(`✗ cowork-server exited unexpectedly (code ${code}). Re-run \`npm run dev:web\`.`);
    process.exit(1);
  });

  /* Boot Vite in this process, as `vite dev src/renderer --open /` would.
     BUILD_TARGET=web activates the cowork-web-root-rewrite middleware in
     vite.config.ts, which maps `/` to `/index-web.html`, so the bare URL is
     the canonical one.

     There is no desktop main here to add the server's bearer token and window
     proof, so Vite's /api proxy adds them to requests from its own pages
     (src/renderer/dev-api-proxy.ts). createDevWebServer hands them to Vite's
     config as an argument, so they never enter an environment variable, which
     every process Vite starts would inherit. */
  vite = await createDevWebServer(launch, { server: { open: '/' } });
  await vite.listen();
  vite.printUrls();
  /* Vite's own shortcuts, as `vite dev` binds them. Its `q` closes Vite and
     exits, and start-server.mjs's exit handler then stops the server. */
  vite.bindCLIShortcuts({ print: true });
}

async function shutdown() {
  if (shuttingDown) {
    // Second Ctrl-C: force-exit. Don't wait for graceful shutdown.
    console.error('\n✗ Force-quit.');
    stop();
    process.exit(130);
  }
  shuttingDown = true;

  /* Order: Vite first, then python. Vite stops proxying once it closes, and
     only then is the (detached) python sent SIGTERM, so the terminal does not
     fill with ECONNREFUSED from requests still proxied to a dying server.
     start-server.mjs leaves SIGINT and SIGTERM to this handler for that
     reason. Five seconds bounds a Vite that hangs on close. */
  if (vite) await Promise.race([vite.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
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
