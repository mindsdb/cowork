// Environment-aware MindsHub URL family for the main (Node) process.
//
// The renderer has its own mirror (src/renderer/lib/mindsUrls.ts) that reads
// import.meta.env, which Vite bakes at build time. The main process is
// compiled with plain `tsc` and does NOT inline env vars, so a build-time
// VITE_MINDS_API_URL is gone by the time a packaged app runs on a user's
// machine. We therefore read the value the same way as the server ref: baked
// into build-channel.gen.ts by scripts/gen-build-channel.mjs at build time.
//
// Resolution order:
//   process.env.MINDS_API_HOST  — explicit runtime override (dev / tests)
//   BUILD_MINDS_API_URL         — baked at build time (packaged apps)
//   'https://api.mindshub.ai'   — prod fallback
//
// URL pattern:
//   prod:    api.mindshub.ai    / auth.mindshub.ai    / console.mindshub.ai
//   staging: api.staging.mindshub.ai / auth.staging.mindshub.ai / console.staging.mindshub.ai
//   dev:     api.dev.mindshub.ai     / auth.dev.mindshub.ai     / console.dev.mindshub.ai

function bakedApiUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./build-channel.gen') as Record<string, string>;
    return typeof mod.BUILD_MINDS_API_URL === 'string' ? mod.BUILD_MINDS_API_URL : '';
  } catch {
    return '';
  }
}

// Normalize to a bare origin ("https://api.staging.mindshub.ai") so a value
// that arrives with a path (e.g. ".../v1") or trailing slash can't leak into
// the derived auth/console hosts.
function toOrigin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/+$/, '');
  }
}

const API_HOST = toOrigin(
  process.env.MINDS_API_HOST || bakedApiUrl() || 'https://api.mindshub.ai',
);

export const MINDS_API_HOST = API_HOST;
export const MINDS_AUTH_HOST = API_HOST.replace('://api.', '://auth.');
export const MINDS_CONSOLE_HOST = API_HOST.replace('://api.', '://console.');

export const MINDS_KEYCLOAK_BASE = `${MINDS_AUTH_HOST}/auth`;
export const MINDS_AUTH_SERVICE_URL = `${MINDS_AUTH_HOST}/v1`;
export const MINDS_LLM_BASE_URL = `${API_HOST}/v1`;

// The environment slug embedded in the API host ("staging"/"dev"), or "" for
// prod. Used to stamp ENV on the cowork-server subprocess we spawn so the
// server's own env-aware defaults (cowork-server app_settings._env_slug)
// resolve to the same environment as the desktop client.
const slugMatch = API_HOST.match(/^https?:\/\/api\.([a-z0-9-]+)\.mindshub\.ai/i);
export const MINDS_ENV_SLUG = slugMatch ? slugMatch[1] : '';
