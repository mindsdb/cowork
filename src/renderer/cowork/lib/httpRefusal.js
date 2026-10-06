/* What a refused request (a non-2xx answer) says about itself: the sentence to
   show, the code to branch on, and when to try again. Pure, so api.js's
   responseError stays a thin reader of the Response and every body shape is
   testable on its own. */

/**
 * The sentence and machine code in a refused request's body.
 * @typedef {object} RefusalBody
 * @property {string} message The sentence to show, or '' when the body names none.
 * @property {string|null} code The body's code, such as `server_busy`.
 */

/**
 * When a refused request may be sent again.
 * @typedef {object} RetryHint
 * @property {number|null} retry_after Seconds left to wait.
 * @property {string|null} retry_at The instant the wait ends, as ISO 8601 in UTC.
 */

const NO_HINT = Object.freeze({ retry_after: null, retry_at: null });

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? '';
}

/**
 * Reads a refused request's body text.
 *
 * The sentence comes from, in order: a string `detail` (FastAPI's HTTPException
 * and RFC 9457 problem details), an object detail's `message` (cowork-server's
 * permission refusals), FastAPI's validation list, RFC 9457's `title`, a
 * top-level `message`, then an OpenAI-style `error.message`. A body that isn't
 * JSON is the server's own text, unless it is markup: an HTML error page from a
 * proxy is noise to a reader, so the caller's fallback shows instead.
 *
 * @param {string} text
 * @returns {RefusalBody}
 */
export function readRefusalBody(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { message: raw.startsWith('<') ? '' : raw, code: null };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { message: '', code: null };
  }
  const { detail } = data;
  const detailObject = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null;
  const validationErrors = Array.isArray(detail)
    ? detail.map((e) => e?.msg || JSON.stringify(e)).join(', ')
    : null;
  return {
    message: firstText(
      detail,
      detailObject?.message,
      validationErrors,
      data.title,
      data.message,
      data.error?.message,
    ),
    code: firstText(data.code, detailObject?.code) || null,
  };
}

function hintAt(retryAfter, atMs) {
  const at = new Date(atMs);
  return Number.isNaN(at.getTime())
    ? NO_HINT
    : { retry_after: retryAfter, retry_at: at.toISOString() };
}

/**
 * Reads a Retry-After header, which is either delay-seconds or an HTTP-date
 * (RFC 9110, section 10.2.3). Both become the seconds left and the absolute
 * instant the wait ends, which is what ChatView's Retry gate counts down to.
 * A date already past means no wait. Anything else is no hint.
 *
 * @param {string|null|undefined} value
 * @param {number} [nowMs]
 * @returns {RetryHint}
 */
export function readRetryAfter(value, nowMs = Date.now()) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return hintAt(seconds, nowMs + seconds * 1000);
  }
  /* Every HTTP-date form names its day and month. Requiring a letter keeps
     Date.parse, which reads "-1" or "1.5" as a day in 2001, away from values
     that are no date at all. */
  if (!/[a-z]/i.test(raw)) return NO_HINT;
  const atMs = Date.parse(raw);
  if (Number.isNaN(atMs)) return NO_HINT;
  return hintAt(Math.max(0, Math.ceil((atMs - nowMs) / 1000)), atMs);
}
