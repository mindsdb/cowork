/**
 * Decode base64url bytes as UTF-8 before parsing JSON; atob alone interprets non-ASCII names as
 * Latin-1.
 */

/** A JSON object, or null for anything else (arrays and scalars included). */
export function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Return null without throwing for unreadable or non-object payloads.
 * Keep TextDecoder non-fatal: malformed UTF-8 becomes a replacement character rather than treating
 * the user as signed out.
 */
function decodeBase64UrlJson(value) {
  try {
    if (typeof value !== 'string' || !value || value.length % 4 === 1) return null;
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return recordOf(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Decode a JWT's payload segment. Null when the token is absent, malformed, or
 * carries a payload that is not a JSON object.
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const segments = token.split('.');
  if (segments.length < 2) return null;
  return decodeBase64UrlJson(segments[1]);
}
