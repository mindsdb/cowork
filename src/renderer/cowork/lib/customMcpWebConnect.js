// The web half of adding a custom MCP server by URL: the sign-in pop-up, the
// status poll, and reading cowork-server's answers into the shapes the
// desktop screens already use. No imports, so platform/host.ts can load it
// statically and open the pop-up inside the click, before its first await.

// Requests that can run a listing: cowork-server's worst case is 52 seconds.
export const CUSTOM_MCP_LISTING_TIMEOUT_MS = 60_000;
// The same bound as api.js's SHORT_REQUEST_TIMEOUT_MS; host.ts cannot import
// api.js, which imports host.ts.
export const CUSTOM_MCP_REQUEST_TIMEOUT_MS = 10_000;
// cowork-server relays finish and reconnect to auth within 10 seconds.
export const CUSTOM_MCP_RELAY_TIMEOUT_MS = 12_000;
export const CUSTOM_MCP_POLL_MS = 3000;
// Inside auth's 20 minute pending sign-in, long enough for a slow login page.
export const CUSTOM_MCP_SIGN_IN_MS = 10 * 60 * 1000;

const CANCELLED = Object.freeze({ ok: false, code: 'login_failed', reason: 'The connection was cancelled.' });
// Reading the status does not consume it, so a gateway or throttling answer is retried too.
const TRANSIENT = new Set(['timeout', 'unreachable', 'http_429', 'http_502', 'http_503', 'http_504']);

/** @type {object | null} */
let active = null;

function closePopup(popup) {
  if (!popup) return;
  try { popup.close(); } catch { /* already closed */ }
}

/**
 * Opens an empty pop-up for the sign-in. Call it inside the click, before any
 * await, or the browser blocks it. Its opener is cut at once, so the login
 * page gets no handle on this tab.
 *
 * @param {Window} [win]
 * @returns {{popup: Window | null, cancelled: boolean, whenCancelled: Promise<typeof CANCELLED>}}
 */
export function beginCustomMcpSignIn(win = window) {
  let popup = null;
  try { popup = win.open('', '_blank'); } catch { popup = null; }
  if (popup) {
    try { popup.opener = null; } catch { /* a closed pop-up */ }
  }
  let cancel = () => {};
  const whenCancelled = new Promise((resolve) => { cancel = () => resolve(CANCELLED); });
  const signIn = { popup, cancelled: false, whenCancelled, cancel };
  if (active) cancelCustomMcpSignIn();
  active = signIn;
  return signIn;
}

/** Cancels the sign-in running now: closes its pop-up and ends its wait. The
 *  request in flight is not aborted; its answer is ignored when it comes. */
export function cancelCustomMcpSignIn() {
  const signIn = active;
  if (!signIn) return;
  active = null;
  signIn.cancelled = true;
  closePopup(signIn.popup);
  signIn.cancel();
}

/** Closes the sign-in's pop-up once it is no longer needed. */
export function endCustomMcpSignIn(signIn) {
  if (!signIn) return;
  closePopup(signIn.popup);
  if (active === signIn) active = null;
}

/**
 * The login URL when it is an https address, otherwise null.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function httpsLoginUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Sends the pop-up to the login page, unless the sign-in was cancelled. Anything
 * but https closes the pop-up and opens nothing. A blocked or vanished pop-up is refused: any other window
 * opened now, outside the click, would be blocked too.
 *
 * @param {{popup: Window | null}} signIn
 * @param {unknown} authUrl
 * @returns {{ok: true} | {ok: false, code: string, reason: string}}
 */
export function openLoginPage(signIn, authUrl) {
  if (signIn.cancelled) return CANCELLED;
  const url = httpsLoginUrl(authUrl);
  if (!url) {
    endCustomMcpSignIn(signIn);
    return { ok: false, code: 'insecure_login_url', reason: '' };
  }
  // Addressing a closed pop-up does nothing rather than throw, so ask first.
  if (signIn.popup && !signIn.popup.closed) {
    try {
      signIn.popup.location.href = url;
      return { ok: true };
    } catch { /* a pop-up the browser will not let this tab address */ }
  }
  endCustomMcpSignIn(signIn);
  return { ok: false, code: 'popup_blocked', reason: '' };
}

/**
 * Settles with `request`'s answer, or with the cancelled answer as soon as
 * the sign-in is cancelled; the request itself runs on.
 *
 * @template T
 * @param {{whenCancelled: Promise<typeof CANCELLED>} | null} signIn
 * @param {Promise<T>} request
 * @returns {Promise<T | typeof CANCELLED>}
 */
function unlessCancelled(signIn, request) {
  return signIn ? Promise.race([request, signIn.whenCancelled]) : request;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the sign-in's status until it ends. Each request is sent only after
 * the previous one answered. A timed-out, unanswered or transiently refused
 * poll is retried until the overall deadline.
 *
 * @param {{cancelled: boolean, whenCancelled: Promise<typeof CANCELLED>}} signIn
 * @param {() => Promise<{ok: true, data: any} | {ok: false, code: string, reason: string}>} readStatus never rejects
 * @param {{sleep?: (ms: number) => Promise<void>, now?: () => number}} [options]
 * @returns {Promise<{ok: true, data: any} | {ok: false, code: string, reason: string}>}
 */
export async function pollCustomMcpSignIn(signIn, readStatus, { sleep = wait, now = Date.now } = {}) {
  const deadline = now() + CUSTOM_MCP_SIGN_IN_MS;
  while (now() < deadline) {
    await unlessCancelled(signIn, sleep(CUSTOM_MCP_POLL_MS));
    if (signIn.cancelled) return CANCELLED;
    const answer = await unlessCancelled(signIn, readStatus());
    if (signIn.cancelled) return CANCELLED;
    if (!answer.ok) {
      if (TRANSIENT.has(answer.code)) continue;
      return answer;
    }
    const status = answer.data?.status;
    if (status === 'success') return answer;
    if (status === 'refused') return { ok: false, code: 'refused', reason: '' };
    if (status === 'error' || status === 'expired') {
      const code = typeof answer.data.error === 'string' && answer.data.error ? answer.data.error : 'login_failed';
      return { ok: false, code, reason: code };
    }
  }
  return { ok: false, code: 'timeout', reason: '' };
}

/**
 * The refusal a cowork-server answer carries: its code and sentence, wherever
 * the relay put them.
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {{ok: false, code: string, reason: string}}
 */
export function customMcpFailure(status, body) {
  const data = body && typeof body === 'object' ? body : {};
  const detail = data.detail;
  const inner = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const text = (value) => (typeof value === 'string' && value ? value : null);
  const detailCode = text(detail) && /^[a-z_]+$/.test(detail) ? detail : null;
  const code = text(data.error) || text(data.code) || text(inner.error) || text(inner.code) || detailCode || `http_${status}`;
  const reason = (detailCode ? null : text(detail)) || text(inner.message) || text(inner.detail) || text(data.message) || '';
  return { ok: false, code, reason };
}

/**
 * A connected server as the connect form reads it.
 *
 * @param {any} data a `connected` or `success` answer
 * @param {string} name the connection's name, when the answer names none
 */
export function connectedFrom(data, name) {
  return {
    ok: true,
    id: typeof data.name === 'string' && data.name ? data.name : name,
    label: typeof data.label === 'string' ? data.label : '',
    serverUrl: typeof data.server_url === 'string' ? data.server_url : '',
    toolsOn: Number.isInteger(data.tools_on) ? data.tools_on : 0,
    toolsUnavailable: data.tools_unavailable === true,
  };
}

/**
 * A tool list as the detail panel reads it, with the revision a switch save
 * must send back.
 *
 * @param {any} data `{tools_revision, tools, stale?, code?}`
 */
export function toolsFrom(data) {
  const entries = Array.isArray(data?.tools) ? data.tools : [];
  const tools = entries.filter((tool) => tool && typeof tool === 'object').map((tool) => ({
    name: String(tool.name),
    description: typeof tool.description === 'string' ? tool.description : '',
    readOnly: tool.read_only === true,
    allowed: tool.allowed === true,
    usable: tool.usable !== false,
    reason: typeof tool.reason === 'string' && tool.reason ? tool.reason : null,
  }));
  const stale = data?.stale === true;
  return {
    ok: true,
    tools,
    revision: Number.isInteger(data?.tools_revision) ? data.tools_revision : null,
    ...(stale ? { stale, staleCode: customMcpFailure(0, data).code } : {}),
  };
}
