/**
 * The renderer's single base64url → JSON decode for JWT payloads.
 *
 * `atob` returns a *binary string* — one JS character per byte — so
 * `JSON.parse(atob(payload))` reads a UTF-8 payload as Latin-1 and mangles
 * every non-ASCII character. `Solórzano` (`ó` = C3 B3) rendered as
 * `SolÃ³rzano` in the account menu for exactly that reason (ENG-2138). The
 * bytes have to pass through `TextDecoder` before they are text.
 *
 * This module exists because four call sites hand-rolled the same decode and
 * two of them dropped that step, so the bug was invisible until a user with an
 * accent in their name signed in. Import from here rather than writing a
 * fifth copy.
 */

/** A JSON object, or null for anything else (arrays and scalars included). */
export function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Decode one base64url-encoded JSON segment.
 *
 * Returns null — never throws — for anything that is not a base64url string
 * encoding a JSON object. Every caller treats null as "unreadable" and falls
 * back to a signed-out or unknown state, so a malformed token must not
 * propagate an exception through a render.
 */
export function decodeBase64UrlJson(value) {
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
