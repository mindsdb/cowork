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
