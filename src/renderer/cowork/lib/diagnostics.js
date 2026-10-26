// The diagnostics a user copies off a failed turn, and the scrub every
// consumer of the sidecar log tail runs first.
//
// The tail is raw sidecar stdout+stderr (main/server-process.ts caps it at
// 32KB). Nothing between the sidecar and here redacts anything, and the same
// text is rendered in the backend settings panel and the offline help modal,
// so the scrub lives here and all three call it.

export const LOG_TAIL_LINES = 200;

const REDACTED = '[redacted]';
const DASH = '—';

// Ordered most specific first. Each keeps enough shape for the line to stay
// readable — a reader still sees that a key was present and where.
//
// `[^\S\n]` rather than `\s` throughout: `\s` matches a newline, so a line
// ending in a bare keyword would swallow the next line's first token.

// Names whose value is a secret. A bare `key` is deliberately NOT here: a
// sidecar built on SQLModel and Alembic logs idempotency_key, primary_key,
// sort_key and foreign_key constantly, and blanking those takes the
// explanation out of the log along with nothing of value. The prefixes below
// cover the real credential names, AWS_SECRET_ACCESS_KEY included.
const SECRET_NAME =
  '(?:api|secret|private|signing|encryption|access|auth)[_-]?key'
  + '|secret|password|passwd|pwd|token|credential|cookie|session|signature';

const SECRET_PATTERNS = [
  // DSN credentials: scheme://user:secret@host — keep user and host. The
  // username is optional because `redis://:pass@host` is the normal form.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)([^\s@/]+)(@)/gi, `$1${REDACTED}$3`],
  // Authorization headers, before the generic rule. The generic one would
  // consume the scheme word and stamp [redacted] beside an intact credential,
  // which reads as handled and is worse than leaving the line alone.
  // The name and value may be quoted, as a JSON or Python dict of headers prints
  // them, or quoted with backslashes, as JSON stored inside a JSON string is.
  // A letters-only first word followed by a space is the scheme; a token never is.
  // A quoted value ends only at its own opening quote; an unquoted one at a space.
  [/\b(authorization\\?["']?[^\S\n]*[=:][^\S\n]*)(\\?["'])(?:([A-Za-z]+)[^\S\n]+)?(?:(?!\2)(?:[^\s"'\\]|\\.))+/gi,
    (_m, head, quote, scheme) => `${head}${quote}${scheme ? `${scheme} ` : ''}${REDACTED}`],
  [/\b(authorization\\?["']?[^\S\n]*[=:][^\S\n]*)(?!\\?["'])(?:([A-Za-z]+)[^\S\n]+)?(?:[^\s"'\\]|\\.)+/gi,
    (_m, head, scheme) => `${head}${scheme ? `${scheme} ` : ''}${REDACTED}`],
  // Bearer tokens anywhere else.
  [/\b(bearer[^\S\n]+)[\w.\-~+/]{8,}={0,2}/gi, `$1${REDACTED}`],
  // Provider key shapes that are recognisable on their own.
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(gh[pousr]_[A-Za-z0-9]{16,})/g, REDACTED],
  // Google API keys, which Gemini uses: AIza and 35 more characters.
  [/(?<![0-9A-Za-z-])AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g, REDACTED],
  // Quoted values, which may contain spaces. Python's dict and repr output is
  // single-quoted, so both styles are admitted, and JSON stored inside a JSON
  // string quotes with \". Each value ends only at its own opening quote, so
  // `it's` and `\"` inside a value do not end it early.
  [new RegExp(
    `((?:^|[^\\w\\-/])\\\\?["']?[\\w-]*(?:${SECRET_NAME}))(\\\\?["']?[^\\S\n]*[=:][^\\S\n]*)(\\\\?["'])(?:(?!\\3)(?:[^\\\\\n]|\\\\.))*\\3`,
    'gim'), `$1$2$3${REDACTED}$3`],
  // A quoted value with no closing quote on its line (cut off, or split across
  // lines) is redacted to the end of the line; ones the rule above closed are skipped.
  [new RegExp(
    `((?:^|[^\\w\\-/])\\\\?["']?[\\w-]*(?:${SECRET_NAME}))(\\\\?["']?[^\\S\n]*[=:][^\\S\n]*)(\\\\?["'])(?!\\[redacted\\]\\3)[^\n]*`,
    'gim'), `$1$2$3${REDACTED}`],
  // Bare values. A name preceded by `/` is skipped: `/api/v1/secret: 200` is a
  // request path and a status code, not a key and a secret.
  // The name is matched with its prefix, not on a word boundary:
  // `_` is a word character, so `\b` would never match GITHUB_CLIENT_SECRET,
  // and main/credential-provisioning.ts spreads exactly those names into the
  // sidecar's environment.
  [new RegExp(
    `((?:^|[^\\w\\-/])[\\w-]*(?:${SECRET_NAME}))([^\\S\n]*[=:][^\\S\n]*)([^\\s"',;]+)`,
    'gim'), `$1$2${REDACTED}`],
];

/**
 * Redact secret-shaped values from a sidecar log tail.
 *
 * Redacts only. The panels that render this show the whole tail, and dropping
 * their earlier lines would take the startup records that explain a config or
 * port failure. The clipboard applies its own cap in diagnosticsText.
 *
 * @param {string|undefined|null} text Raw `recentLog` from server diagnostics.
 * @returns {string} The same text with secret-shaped values replaced. Never null.
 */
export function scrubLog(text) {
  if (!text) return '';
  let out = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Build the clipboard payload for a failed turn.
 *
 * Contains only what `server:get-diagnostics` and the version readout already
 * expose. Deliberately no traceback, no request body, no credential.
 *
 * @param {object} args
 * @param {[string, string][]} args.rows Version rows from versionRows().
 * @param {string} args.requestId The turn's server-side correlation id.
 * @param {string} args.code The failure's wire code.
 * @param {string} [args.log] Raw recentLog; scrubbed here, omitted when empty.
 * @returns {string} Plain text ready for the clipboard.
 */
export function diagnosticsText({ rows, requestId, code, log }) {
  const parts = (rows || []).map(([k, v]) => `${k}: ${v}`);
  parts.push(`Reference: ${requestId}`);
  // A failure can carry an id and no code; printing "null" helps nobody.
  parts.push(`Error code: ${code || DASH}`);
  // A dash comes from an earlier /health snapshot that lacked the version, or
  // from no snapshot at all, so it says nothing about the server at copy time.
  const backendMissing = (rows || []).some(([k, v]) => (k === 'Server' || k === 'Agent') && v === DASH);
  if (backendMissing) parts.push(`Note: ${DASH} means the server did not report that version.`);
  const scrubbed = scrubLog(log).split('\n').slice(-LOG_TAIL_LINES).join('\n');
  if (scrubbed) parts.push('', 'Recent server log:', scrubbed);
  return parts.join('\n');
}
