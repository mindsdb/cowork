// MindsHub URL family — shared by the arcade onboarding screens and the
// cowork SPA views (billing/API-key links), so every external MindsHub
// destination is derived in one place from the two VITE_ overrides.

// Derive the MindsHub API base from the SPA's own origin so a single web build
// serves every environment without baking a per-env URL. The MindsHub cloud API
// is a sibling of the cowork host on the same domain, reached by swapping the
// leading `cowork` token of the first host label for `api`. Two host shapes:
//   static: cowork.<env>.mindshub.ai   -> api.<env>.mindshub.ai
//           cowork.mindshub.ai (prod)  -> api.mindshub.ai
//   PR:     cowork-<pr>.dev.mindshub.ai -> api-<pr>.dev.mindshub.ai
//
// Only derive on a real remote host whose first label is a cowork host. In
// Electron the renderer loads over file:// (no meaningful origin), localhost dev
// has no sibling `api` host, and an unrecognised host shape can't be mapped, so
// all three fall back to prod. This matches the behaviour the tests lock in and
// avoids the file:// misfire that once stranded auth on the dev host.
function deriveMindsApiBaseFromOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, hostname, host } = window.location;
  const isRemoteWeb =
    (protocol === 'http:' || protocol === 'https:') &&
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '::1';
  if (!isRemoteWeb) return null;
  const [first, ...rest] = host.split('.');
  if (first !== 'cowork' && !first.startsWith('cowork-')) return null;
  const apiFirst = first.replace(/^cowork/, 'api');
  return `${protocol}//${[apiFirst, ...rest].join('.')}`;
}

export const MINDS_API_BASE =
  import.meta.env.VITE_MINDS_API_URL
  || deriveMindsApiBaseFromOrigin()
  // `vite dev` with no baked VITE_MINDS_API_URL targets staging, not prod, so a
  // bare `npm run dev` never authenticates against production. Built renderers
  // carry a baked URL, so this ternary only affects local dev.
  || (import.meta.env.DEV ? 'https://api.staging.mindshub.ai' : 'https://api.mindshub.ai');

// Rewrite the leading `api` service token of the resolved MindsHub API base to
// another role, handling both host shapes: `://api.` (static) and `://api-`
// (PR). Keeps auth/console in lockstep with whatever MINDS_API_BASE resolved to
// (origin-derived OR an explicit VITE_MINDS_API_URL override).
const mindsServiceHost = (role: 'auth' | 'console'): string =>
  MINDS_API_BASE.replace(/:\/\/api([.-])/, `://${role}$1`);

// Keycloak host, derived from the SAME resolved base as everything else
// (api.X → auth.X) so the login flow (keycloak.ts, which imports
// MINDS_KEYCLOAK_URL) and the sign-up link below can never point at different
// environments. VITE_KEYCLOAK_URL wins as an explicit override; otherwise we
// derive from MINDS_API_BASE — the *already-resolved* value, so when
// VITE_MINDS_API_URL is unset (prod builds don't pass it) auth tracks the same
// prod fallback the API host uses. Deriving from the resolved base — not a
// runtime web-vs-Electron guess — is what keeps the two in lockstep: the
// packaged desktop app serves the renderer over file://, so any protocol-based
// "isWeb" heuristic misfires and would strand auth on the dev host.
export const MINDS_KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL
  || `${mindsServiceHost('auth')}/auth`;
// Strip only a TRAILING "/auth" — a bare .replace('/auth','') matches the
// "//auth" inside the domain (https://auth.mindshub.ai) and mangles the
// URL into "https:/.mindshub.ai/auth", which fails to open.
const KEYCLOAK_BASE = MINDS_KEYCLOAK_URL.replace(/\/auth\/?$/, '');

// Single source of truth for the MindsHub console. Flip to
// https://console.mindshub.ai when the desktop app moves to prod.
export const MINDS_CONSOLE_URL = mindsServiceHost('console');
export const MINDS_BILLING_URL = `${MINDS_CONSOLE_URL}/settings/organization/billing`;
export const MINDS_API_KEY_URL = `${MINDS_CONSOLE_URL}/apiKeys`;

// MindsHub sign-up: the Keycloak registration flow (not the account
// page), which lands the new user back on the console. Built from the
// base vars so it stays correct if VITE_KEYCLOAK_URL / VITE_MINDS_API_URL
// are overridden for a non-prod environment.
export const MINDS_REGISTER_URL = `${KEYCLOAK_BASE}/auth/realms/mindsdb/protocol/openid-connect/registrations?client_id=public-client&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${MINDS_CONSOLE_URL}/`)}`;
