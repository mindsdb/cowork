// The diagnostics a user copies off a failed turn, and the scrub every
// consumer of the sidecar log tail runs first.
//
// The tail is raw sidecar stdout+stderr (main/server-process.ts caps it at
// 32KB). Nothing between the sidecar and here redacts anything, and the same
// text is rendered in the backend settings panel and the offline help modal,
// so the scrub lives here and all three call it.

export const LOG_TAIL_LINES = 200;

const REDACTED = '[redacted]';

// Ordered most specific first. Each keeps enough shape for the line to stay
// readable — a reader still sees that a key was present and where.
const SECRET_PATTERNS = [
  // DSN credentials: scheme://user:secret@host — keep user and host.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi, `$1${REDACTED}$3`],
  // Bearer / token headers.
  [/\b(bearer\s+)[\w.\-~+/]{8,}={0,2}/gi, `$1${REDACTED}`],
  // Provider key shapes that are recognisable on their own.
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(gh[pousr]_[A-Za-z0-9]{16,})/g, REDACTED],
  // key=value / key: value pairs whose NAME says it is a secret.
  [/\b(api[_-]?key|secret|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|authorization)(\s*[=:]\s*)("?)([^\s"',;]+)\3/gi,
    `$1$2$3${REDACTED}$3`],
];

/**
 * Redact secret-shaped values from a sidecar log tail and keep only its end.
 *
 * @param {string|undefined|null} text Raw `recentLog` from server diagnostics.
 * @returns {string} The scrubbed tail, at most LOG_TAIL_LINES lines. Never null.
 */
export function scrubLog(text) {
  if (!text) return '';
  let out = String(text);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  const lines = out.split('\n');
  return lines.slice(-LOG_TAIL_LINES).join('\n');
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
  parts.push(`Error code: ${code}`);
  // A dash in either backend row means /health did not answer. Say why, or the
  // reader is left guessing whether the version is missing or the server is.
  const backendMissing = (rows || []).some(([k, v]) => (k === 'Server' || k === 'Agent') && v === '—');
  if (backendMissing) parts.push('Note: the server was unreachable when this was copied.');
  const scrubbed = scrubLog(log);
  if (scrubbed) parts.push('', 'Recent server log:', scrubbed);
  return parts.join('\n');
}
