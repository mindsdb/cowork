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

/*
 * The model every provider probe sends to MindsHub, and the mirror of
 * cowork-server's MINDS_PROBE_MODEL (cowork/services/providers.py).
 *
 * It has to be a model any valid key can call. MindsHub bills per model, so a
 * paid model is denied for an account whose wallet is empty, and that denial
 * arrives as an ordinary error the probe cannot tell apart from a bad key:
 * onboarding then tells a brand-new user their working key does not work.
 * MindsHub Air draws the monthly included allowance instead of the wallet, so
 * the probe reports reachability and key validity, which is what it is for.
 *
 * Two copies of this value exist because main is compiled Node with no import
 * path into the Python sidecar. They have drifted once already: an earlier fix
 * moved the sidecar onto the free model and left this side probing a paid one,
 * which is the defect this replaces. Change one and change the other.
 */
export const MINDS_PROBE_MODEL = 'mindshub_air';

/*
 * True when `url` points at a MindsHub inference host. Mirrors is_minds_host in
 * cowork-server's providers.py, including the deliberate choice to compare the
 * parsed hostname rather than test a substring of the URL: a substring test also
 * matches `mindshub.ai.example.test` and a query parameter carrying our host,
 * and the base URL reaching the openai-compatible probe is partly user-supplied.
 *
 * A self-hosted gateway on another hostname does not match, and keeps the
 * generic default it has today.
 *
 * Matching an `mdb.ai` host picks the model, not the path: the openai-compatible
 * probe appends `/v1` generically and never applies validateMinds's `mdb.ai` ->
 * `/api/v1` rule, so a bare `mdb.ai` base is still probed where that host does not
 * serve. Same caveat as the sidecar's is_minds_host.
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

// The environment slug embedded in the API host ("staging"/"dev"), or "" for
// prod. Used to stamp ENV on the cowork-server subprocess we spawn so the
// server's own env-aware defaults (cowork-server app_settings._env_slug)
// resolve to the same environment as the desktop client.
const slugMatch = API_HOST.match(/^https?:\/\/api\.([a-z0-9-]+)\.mindshub\.ai/i);
export const MINDS_ENV_SLUG = slugMatch ? slugMatch[1] : '';
