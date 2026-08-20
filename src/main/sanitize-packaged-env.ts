// ENG-1353: a packaged build must take its channel scope from its baked config,
// never from the launch shell. Otherwise a stray var left over from QA-ing
// another channel (e.g. COWORK_HOME=~/.cowork-stable) is inherited on a terminal
// launch and silently repoints the installed build at that channel's data/port/
// binary/host — a prod build was seen reading the staging DB. Internal-only: a
// Finder/Dock launch gets launchd's minimal env, so this never hits a customer.
//
// Scrubbing these once, here, lets every downstream reader (cowork-home,
// server-process, uv-paths, minds-urls) keep its plain "no override → derive
// from build kind" path with no per-site gating. Unpackaged (dev/web/tests) is
// untouched so the Vite proxy and local overrides still work.
//
// ORDERING: runs as an import side effect and MUST be index.ts's first local
// import — ahead of app-identity (caches buildKind() at load) and minds-urls
// (resolves MINDS_API_HOST at load).

import { app } from 'electron';

/** Channel-scoping vars a packaged build must not inherit: data home
 *  (COWORK_HOME), port (COWORK_SERVER_PORT / COWORK_LISTEN_PORT /
 *  ANTON_SERVER_PORT), resolved kind (COWORK_BUILD_KIND), uv tool dir
 *  (UV_TOOL_DIR / UV_TOOL_BIN_DIR), and API host (MINDS_API_HOST). */
export const CHANNEL_SCOPING_ENV_VARS = [
  'COWORK_HOME',
  'COWORK_SERVER_PORT',
  'COWORK_LISTEN_PORT',
  'ANTON_SERVER_PORT',
  'COWORK_BUILD_KIND',
  'UV_TOOL_DIR',
  'UV_TOOL_BIN_DIR',
  'MINDS_API_HOST',
] as const;

/** Strip the channel-scoping vars from `env` when packaged; no-op otherwise.
 *  Pure over its arguments so the invariant is testable without module reloads. */
export function sanitizePackagedEnv(env: NodeJS.ProcessEnv, isPackaged: boolean): void {
  if (!isPackaged) return;
  for (const key of CHANNEL_SCOPING_ENV_VARS) delete env[key];
}

// `app?.`: outside Electron (tests/tooling) `app` is undefined → unpackaged → no-op.
sanitizePackagedEnv(process.env, app?.isPackaged ?? false);
