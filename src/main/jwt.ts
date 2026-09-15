// Reading claims out of a token this process already holds.
//
// Not verification: the token was issued to us over TLS and is only read here
// for the account it names and the organization claim. Anything that decides
// access is the gateway's job, never this.

/** The payload of a compact JWS, or null when it cannot be read as one. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    // Buffer is fine in the main process (Node); base64 → utf8.
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/** The account a token names, or null when it names none readably. */
export function accountIdFromToken(token: string | null): string | null {
  if (!token) return null;
  const sub = decodeJwtPayload(token)?.sub;
  return typeof sub === 'string' && sub.trim() ? sub.trim() : null;
}

/** Something to show a person so they know which account they are answering
 *  for. Not identity: only a label, and null when the token carries none. */
export function accountLabelFromToken(token: string | null): string | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  for (const claim of ['email', 'preferred_username', 'name'] as const) {
    const value = payload?.[claim];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * The raw active-organization claim, whichever name the issuer used.
 *
 * The three names live here and nowhere else: the data root and the
 * organization list are both derived from this claim, and if they ever read
 * different names they would disagree about which organization the session is
 * in, which is the whole failure this partitioning exists to prevent.
 */
export function activeOrgClaim(payload: Record<string, unknown> | null): unknown {
  return payload?.active_organization ?? payload?.activate_organization ?? payload?.organization;
}

/** The id inside an organization claim, unwrapping the shapes the issuer uses. */
export function orgIdFromClaim(value: unknown): string | null {
  const raw = (value as { organization?: unknown })?.organization ?? value;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return orgIdFromClaim(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = o.id ?? o.keycloak_id ?? o.organization_id ?? o.org_id ?? o.name;
  return id ? String(id) : null;
}

/** The organization a token names as active, or null when it names none. */
export function activeOrgIdFromToken(token: string | null): string | null {
  if (!token) return null;
  return orgIdFromClaim(activeOrgClaim(decodeJwtPayload(token)));
}
