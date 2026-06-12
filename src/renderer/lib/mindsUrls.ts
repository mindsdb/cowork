// MindsHub URL family — shared by the arcade onboarding screens and the
// cowork SPA views (billing/API-key links), so every external MindsHub
// destination is derived in one place from the two VITE_ overrides.

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.mindshub.ai/auth';
// Strip only a TRAILING "/auth" — a bare .replace('/auth','') matches the
// "//auth" inside the domain (https://auth.mindshub.ai) and mangles the
// URL into "https:/.mindshub.ai/auth", which fails to open.
const KEYCLOAK_BASE = KEYCLOAK_URL.replace(/\/auth\/?$/, '');

export const MINDS_API_BASE = import.meta.env.VITE_MINDS_API_URL || 'https://api.mindshub.ai';

// Single source of truth for the MindsHub console. Flip to
// https://console.mindshub.ai when the desktop app moves to prod.
export const MINDS_CONSOLE_URL = MINDS_API_BASE.replace('://api.', '://console.');
export const MINDS_BILLING_URL = `${MINDS_CONSOLE_URL}/settings/organization/billing`;
export const MINDS_API_KEY_URL = `${MINDS_CONSOLE_URL}/api-key`;

// MindsHub sign-up: the Keycloak registration flow (not the account
// page), which lands the new user back on the console. Built from the
// base vars so it stays correct if VITE_KEYCLOAK_URL / VITE_MINDS_API_URL
// are overridden for a non-prod environment.
export const MINDS_REGISTER_URL = `${KEYCLOAK_BASE}/auth/realms/mindsdb/protocol/openid-connect/registrations?client_id=public-client&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${MINDS_CONSOLE_URL}/`)}`;
