// useCurrentUser — resolves the signed-in user's identity for the redesigned
// artifact workspace (presence avatar, "You" attribution).
//
// The app authenticates with Keycloak; the access token is a JWT whose payload
// carries `email` / `preferred_username` / `name`. We decode it from the same
// `host.getAccessToken()` the API client uses, so this works in BOTH the web
// build and Electron without importing keycloak-js or adding a dependency.
//
// Defensive by design: if there is no token, it isn't a JWT, or decoding fails,
// we return `null` and callers fall back to a generic "You". We never throw.

import { useEffect, useState } from 'react';
import { host } from '../../../../platform/host';

// Decode a JWT payload (base64url → JSON). Returns null on any malformed input.
function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    // atob → percent-escaped → decodeURIComponent so non-ASCII names survive.
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * @returns {{ email: string, name: string } | null}
 *   The signed-in user, or null while loading / when unauthenticated.
 */
export function useCurrentUser() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await host.getAccessToken?.();
        const claims = token ? decodeJwt(token) : null;
        if (cancelled || !claims) return;
        const email = claims.email || claims.preferred_username || '';
        const name =
          claims.name ||
          [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim() ||
          '';
        if (email || name) setUser({ email, name });
      } catch {
        /* unauthenticated / non-JWT token — caller falls back to a generic "You" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return user;
}

export default useCurrentUser;
