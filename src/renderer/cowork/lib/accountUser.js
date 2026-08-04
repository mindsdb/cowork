function decodeJwtPayload(token) {
  try {
    let payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload));
  } catch { return null; }
}

// Pure mapping from an access token to the account card's user object; null
// means "show the sign-in card" — both for a missing token and for one that
// can't be decoded (a stale identity must never keep rendering over a token we
// can no longer read, ENG-761).
export function accountUserFromToken(token) {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return {
    name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || null,
    email: payload.email || null,
    username: payload.preferred_username || null,
    sub: payload.sub || null,
    org: (() => {
      let org = payload.active_organization ?? payload.organization;
      if (typeof org === 'string') { try { org = JSON.parse(org); } catch { return null; } }
      return org?.displayName || org?.name || null;
    })(),
  };
}
