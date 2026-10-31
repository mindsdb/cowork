/*
 * Whether text is one email address by the rule MindsHub's people lookup
 * applies (Django's validate_email), so a typo fails here, before any round
 * trip, rather than as a refused lookup. cowork-server checks every address
 * against the same rule before it asks MindsHub, and owns the answer.
 *
 * The rule: a dot-atom local part (letters, digits and
 * !#$%&'*+/=?^_`{|}~- in runs joined by single dots, so no leading, trailing
 * or doubled dot), "@", then a host name: labels of letters, digits and inner
 * hyphens, up to 63 characters each, joined by dots, ending in a top-level
 * domain of 2 to 63 letters (inner hyphens allowed) or a punycode label
 * ("xn--…"). Letters past ASCII count, as Django's DomainNameValidator counts
 * them (U+00A1 to U+FFFF), so "ana@münchen.de" is an address. At most 320
 * characters in all. Django also takes a quoted local part, a bracketed IP
 * address and "localhost"; this rule doesn't, so an address it passes is one
 * every check down the line takes.
 *
 * Shared by the publish dialog's people field, the recipient picker and a
 * live app's "Share with…".
 */

const ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LETTER = '\\u00a1-\\uffff';
const HOST_LABEL = `[A-Za-z${LETTER}0-9](?:[A-Za-z${LETTER}0-9-]{0,61}[A-Za-z${LETTER}0-9])?`;
const INNER_LABELS = `(?:\\.(?!-)[A-Za-z${LETTER}0-9-]{1,63}(?<!-))*`;
const TOP_LEVEL = `\\.(?!-)(?:[A-Za-z${LETTER}-]{2,63}|xn--[A-Za-z0-9]{1,59})(?<!-)`;
const EMAIL_RULE = new RegExp(`^${ATOM}(?:\\.${ATOM})*@${HOST_LABEL}${INNER_LABELS}${TOP_LEVEL}$`, 'u');
const MAX_EMAIL_CHARS = 320;

/** @param {unknown} value */
export function isEmailShaped(value) {
  const text = String(value ?? '').trim();
  return text.length <= MAX_EMAIL_CHARS && EMAIL_RULE.test(text);
}
