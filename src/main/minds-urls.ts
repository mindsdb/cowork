// Environment-aware MindsHub URL family for the main (Node) process. Unlike the
// renderer mirror (which reads Vite's baked import.meta.env), main is compiled
// with plain `tsc` and reads the value baked into build-channel.gen.ts.
//
// Resolution order (highest priority first):
//   process.env.MINDS_API_HOST     — explicit runtime override (dev / tests)
//   BUILD_MINDS_API_URL            — baked at build time (packaged apps)
//   CHANNELS[buildKind()].apiHost  — the resolved channel's canonical host
//
// That last step lets the channel model drive MAIN, not just the renderer:
// `npm run dev` bakes nothing, and main used to hard-code a PROD fallback while
// the renderer fell back to staging (a split-brain). prod is unchanged either
// way. Hosts follow api/auth/console.<env>.mindshub.ai (bare for prod).

import { CHANNELS } from './channels';
import { buildKind, type BuildKind } from './cowork-home';

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

// Pure so the resolution (incl. the "clean npm run dev" case) is unit-testable
// without electron/module-load gymnastics.
export function resolveApiHost(envHost: string, bakedUrl: string, kind: BuildKind): string {
  const chosen = envHost.trim() || bakedUrl.trim() || CHANNELS[kind].apiHost;
  return toOrigin(chosen);
}

const API_HOST = resolveApiHost(process.env.MINDS_API_HOST ?? '', bakedApiUrl(), buildKind());

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
