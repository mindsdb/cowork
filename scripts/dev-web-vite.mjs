/*
 * The Vite half of `npm run dev:web` (dev-web.mjs, its only caller). Kept apart
 * from the orchestrator so a test can start Vite exactly the way dev:web does.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

/* The name of the plugin whose `api` carries the launch's bearer token and
   window proof, as DEV_PROXY_PLUGIN in src/renderer/dev-api-proxy.ts holds it.
   This script cannot import TypeScript, so it keeps a copy, and
   src/renderer/dev-api-proxy.test.ts pins the two equal. */
export const DEV_PROXY_PLUGIN = 'cowork-dev-proxy-credentials';

const RENDERER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');

/** Creates Vite's dev server for the web build in this process, from the
 *  renderer's own config, as `vite dev src/renderer` would. The launch's bearer
 *  token and window proof reach the /api proxy as the `api` of a
 *  DEV_PROXY_PLUGIN plugin, an argument to createServer, so neither enters an
 *  environment variable or a command line. `options` adds Vite inline options,
 *  such as `server`. */
export function createDevWebServer(launch, options = {}) {
  // BUILD_TARGET=web selects the web entry and its plugins in vite.config.ts.
  process.env.BUILD_TARGET = 'web';
  return createServer({
    ...options,
    root: RENDERER_ROOT,
    configFile: path.join(RENDERER_ROOT, 'vite.config.ts'),
    plugins: [{ name: DEV_PROXY_PLUGIN, api: { authToken: launch.authToken, windowProof: launch.windowProof } }],
  });
}
