// Main uses tsc’s build-channel values rather than the renderer’s Vite environment.
// Resolve runtime override, baked host, then channel host so clean dev builds do not default to
// prod.

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

// Strip paths and trailing slashes before deriving auth and console origins.
function toOrigin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/+$/, '');
  }
}

export function resolveApiHost(envHost: string, bakedUrl: string, kind: BuildKind): string {
  const chosen = envHost.trim() || bakedUrl.trim() || CHANNELS[kind].apiHost;
  return toOrigin(chosen);
}

const API_HOST = resolveApiHost(process.env.MINDS_API_HOST ?? '', bakedApiUrl(), buildKind());

export const MINDS_API_HOST = API_HOST;

/*
 * PR console hosts omit the service prefix; auth hosts retain it.
 * Keep derivation aligned with src/renderer/lib/mindsUrls.ts, which reads different base inputs.
 */
export const MINDS_AUTH_HOST = API_HOST.replace(/:\/\/api([.-])/, '://auth$1');
export const MINDS_CONSOLE_HOST = API_HOST.includes('://api-')
  ? API_HOST.replace('://api-', '://')
  : API_HOST.replace('://api.', '://console.');

export const MINDS_KEYCLOAK_BASE = `${MINDS_AUTH_HOST}/auth`;
export const MINDS_AUTH_SERVICE_URL = `${MINDS_AUTH_HOST}/v1`;
export const MINDS_LLM_BASE_URL = `${API_HOST}/v1`;

/*
 * Use an included-allowance model for probes so an empty wallet does not look like an invalid key.
 * Keep aligned with cowork-server’s MINDS_PROBE_MODEL in cowork/services/providers.py.
 */
export const MINDS_PROBE_MODEL = 'mindshub_air';

/*
 * Match parsed hostnames, not substrings; self-hosted gateways retain generic defaults.
 * This selects a model only: it does not rewrite mdb.ai’s generic /v1 probe path to /api/v1.
 */
export function isMindsHost(url: string | null | undefined): boolean {
  const raw = (url || '').trim();
  if (!raw) return false;
  try {
    /* A bare `api.mindshub.ai/v1` carries no scheme, and URL rejects it; the
     * `//` prefix makes it parse as a host rather than a path. */
    const host = new URL(raw.includes('//') ? raw : `https://${raw}`).hostname.toLowerCase();
    return (
      host === 'mindshub.ai' ||
      host === 'mdb.ai' ||
      host.endsWith('.mindshub.ai') ||
      host.endsWith('.mdb.ai')
    );
  } catch {
    return false;
  }
}

// Stamp the API host’s environment onto the sidecar. Handle both permanent and per-PR host shapes
// so a PR client does not start a sidecar with production defaults.
const slugMatch = API_HOST.match(/^https?:\/\/api[.-][a-z0-9-]*?\.?([a-z0-9-]+)\.mindshub\.ai/i);
export const MINDS_ENV_SLUG = slugMatch ? slugMatch[1] : '';
