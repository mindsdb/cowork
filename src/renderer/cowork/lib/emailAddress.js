/*
 * Whether text has the shape of one email address: a name, "@", and a domain
 * with a dot. A shape check only, shared by the publish dialog's "specific
 * people" field and a live app's "Share with…", so a typo fails before any
 * round trip; the server checks every address again and owns the answer.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {unknown} value */
export function isEmailShaped(value) {
  return EMAIL_SHAPE.test(String(value ?? '').trim());
}
