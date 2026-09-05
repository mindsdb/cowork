// Shared MindsHub destinations derived from the resolved API base and optional Keycloak override.

// Map remote cowork hosts to sibling API hosts: cowork.env → api.env; cowork-pr.dev → api-pr.dev.
// Electron, localhost and unknown host shapes defer to the configured fallback.
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
  // Bare local development defaults to staging; built renderers default to production.
  || (import.meta.env.DEV ? 'https://api.staging.mindshub.ai' : 'https://api.mindshub.ai');

// Map api service tokens to auth/console. PR consoles have no service prefix (api-pr.dev → pr.dev),
// while permanent environments use console.env.
const mindsServiceHost = (role: 'auth' | 'console'): string => {
  if (role === 'console' && MINDS_API_BASE.includes('://api-')) {
    return MINDS_API_BASE.replace('://api-', '://');
  }
  return MINDS_API_BASE.replace(/:\/\/api([.-])/, `://${role}$1`);
};

// Derive auth from the resolved API base unless explicitly overridden; file:// must not choose a
// different environment.
export const MINDS_KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL
  || `${mindsServiceHost('auth')}/auth`;
// Strip only the trailing /auth path; an unanchored replacement would corrupt the auth hostname.
const KEYCLOAK_BASE = MINDS_KEYCLOAK_URL.replace(/\/auth\/?$/, '');

// Derive console from the guarded API base. A separate console override would evade
// gen-build-channel's environment check.
export const MINDS_CONSOLE_URL = mindsServiceHost('console');
export const MINDS_BILLING_URL = `${MINDS_CONSOLE_URL}/settings/organization/billing`;
export const MINDS_API_KEY_URL = `${MINDS_CONSOLE_URL}/apiKeys`;

// Console settings pages the sidebar user menu deep-links to (ENG-1408) —
// same routes the web console's own user menu navigates to.
export const MINDS_PROFILE_URL = `${MINDS_CONSOLE_URL}/settings/personal/profile`;
export const MINDS_GENERAL_URL = `${MINDS_CONSOLE_URL}/settings/organization/general`;
export const MINDS_MEMBERS_URL = `${MINDS_CONSOLE_URL}/settings/organization/members`;
// Workspace management lives in the console; the plural /settings/workspaces namespace differs from
// legacy singular redirects.
export const MINDS_WORKSPACES_URL = `${MINDS_CONSOLE_URL}/settings/workspaces`;

// Environment-independent MindsHub destinations (docs site + support page).
export const MINDS_DOCS_URL = 'https://docs.mindshub.ai';
export const MINDS_SUPPORT_URL = 'https://mindshub.ai/support';

// Open Keycloak registration with a console return URL derived from the same environment.
export const MINDS_REGISTER_URL = `${KEYCLOAK_BASE}/auth/realms/mindsdb/protocol/openid-connect/registrations?client_id=public-client&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${MINDS_CONSOLE_URL}/`)}`;
