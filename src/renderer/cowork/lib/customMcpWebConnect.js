// The web half of adding a custom MCP server by URL: the sign-in pop-up, the
// finish page's nudge, the status poll, and reading cowork-server's answers
// into the shapes the desktop screens already use. No imports, so
// platform/host.ts can load it statically and open the pop-up inside the
// click, before its first await.

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

// Cancel only stops this tab waiting: a sign-in the finish page already saved still stands.
const CANCELLED = Object.freeze({ ok: false, code: 'stopped_waiting', reason: '' });
// Reading the status does not consume it, so a gateway or throttling answer is retried too.
const TRANSIENT = new Set(['timeout', 'unreachable', 'http_429', 'http_502', 'http_503', 'http_504']);
// The finish page nudges waiting tabs to read their own sign-in's status now, instead of at the
// next poll; the pop-up's opener is cut. The nudge carries nothing: each tab's own status record
// is the only source of its outcome, so a finish page for another sign-in costs one extra read.
export const CUSTOM_MCP_SIGN_IN_CHANNEL = 'cowork:custom-mcp-sign-in';
const NUDGE = 'finished';
// The only names a custom MCP connection is given; nothing else goes into a request path.
export const CUSTOM_MCP_CONNECTION_ID = /^cm-[0-9a-f]{32}$/;
const NEVER = new Promise(() => {});

/** @type {object | null} */
let active = null;

function closePopup(popup) {
  if (!popup) return;
  try { popup.close(); } catch { /* already closed */ }
}

function openChannel(Channel) {
  if (typeof Channel !== 'function') return null;
  try { return new Channel(CUSTOM_MCP_SIGN_IN_CHANNEL); } catch { return null; }
}

/**
 * Nudges every tab waiting on a sign-in to read its status now. Without the
 * channel the tabs still read it at their next poll, so a failed post is left to that.
 *
 * @param {typeof BroadcastChannel | undefined} [Channel]
 */
export function nudgeCustomMcpSignIns(Channel = globalThis.BroadcastChannel) {
  const channel = openChannel(Channel);
  if (!channel) return;
  try {
    channel.postMessage(NUDGE);
  } catch { /* the status poll still ends the wait */ } finally {
    channel.close();
  }
}

/**
 * Opens an empty pop-up for the sign-in. Call it inside the click, before any
 * await, or the browser blocks it. Its opener is cut at once, so the login
 * page gets no handle on this tab.
 *
 * Listens for the finish page's nudge from now on.
 *
 * @param {Window} [win]
 * @param {typeof BroadcastChannel | undefined} [Channel]
 * @returns {{popup: Window | null, cancelled: boolean, whenCancelled: Promise<typeof CANCELLED>,
 *   nextNudge: () => Promise<void>, keepPopup: boolean}}
 */
export function beginCustomMcpSignIn(win = window, Channel = globalThis.BroadcastChannel) {
  let popup = null;
  try { popup = win.open('', '_blank'); } catch { popup = null; }
  if (popup) {
    try { popup.opener = null; } catch { /* a closed pop-up */ }
  }
  let cancel = () => {};
  const whenCancelled = new Promise((resolve) => { cancel = () => resolve(CANCELLED); });
  let nudge = () => {};
  let nudged = NEVER;
  const arm = () => { nudged = new Promise((resolve) => { nudge = resolve; }); };
  const channel = openChannel(Channel);
  if (channel) {
    arm();
    channel.onmessage = (event) => {
      if (event.data !== NUDGE) return;
      const wake = nudge;
      arm();
      wake();
    };
  }
  const nextNudge = () => nudged;
  const signIn = { popup, cancelled: false, whenCancelled, cancel, nextNudge, channel, keepPopup: false };
  if (active) cancelCustomMcpSignIn();
  active = signIn;
  return signIn;
}

function stopListening(signIn) {
  if (!signIn.channel) return;
  try { signIn.channel.close(); } catch { /* already closed */ }
  signIn.channel = null;
}

/** Cancels the sign-in running now: closes its pop-up and ends its wait. The
 *  request in flight is not aborted; the caller decides what its answer means. */
export function cancelCustomMcpSignIn() {
  const signIn = active;
  if (!signIn) return;
  active = null;
  signIn.cancelled = true;
  stopListening(signIn);
  closePopup(signIn.popup);
  signIn.cancel();
}

/** Ends the sign-in: stops listening and closes its pop-up, unless the sign-in
 *  failed and the pop-up shows why, which the member closes. */
export function endCustomMcpSignIn(signIn) {
  if (!signIn) return;
  stopListening(signIn);
  if (!signIn.keepPopup) closePopup(signIn.popup);
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
 * @param {{whenCancelled: Promise<typeof CANCELLED>}} signIn
 * @param {Promise<T>} request
 * @returns {Promise<T | typeof CANCELLED>}
 */
export function unlessCancelled(signIn, request) {
  return Promise.race([request, signIn.whenCancelled]);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the sign-in's status to end. It is read every poll interval, and
 * at once when the finish page nudges. Each request is sent only after the
 * previous one answered. A timed-out, unanswered or transiently refused read
 * is retried until the overall deadline. A failure carries auth's code and
 * sentence, and keeps the pop-up open on the page that says why.
 *
 * @param {{cancelled: boolean, whenCancelled: Promise<typeof CANCELLED>,
 *   nextNudge?: () => Promise<void>, keepPopup?: boolean}} signIn
 * @param {() => Promise<{ok: true, data: any} | {ok: false, code: string, reason: string}>} readStatus never rejects
 * @param {{sleep?: (ms: number) => Promise<void>, now?: () => number}} [options]
 * @returns {Promise<{ok: true, data: any} | {ok: false, code: string, reason: string}>}
 */
export async function pollCustomMcpSignIn(signIn, readStatus, { sleep = wait, now = Date.now } = {}) {
  const deadline = now() + CUSTOM_MCP_SIGN_IN_MS;
  const text = (value) => (typeof value === 'string' && value ? value : '');
  while (now() < deadline) {
    await Promise.race([sleep(CUSTOM_MCP_POLL_MS), signIn.whenCancelled, signIn.nextNudge ? signIn.nextNudge() : NEVER]);
    if (signIn.cancelled) return CANCELLED;
    const answer = await unlessCancelled(signIn, readStatus());
    if (signIn.cancelled) return CANCELLED;
    if (!answer.ok) {
      if (TRANSIENT.has(answer.code)) continue;
      return answer;
    }
    const status = answer.data?.status;
    if (status === 'success') return answer;
    if (status === 'refused') {
      signIn.keepPopup = true;
      return { ok: false, code: 'refused', reason: '' };
    }
    if (status === 'error' || status === 'expired') {
      signIn.keepPopup = true;
      return { ok: false, code: text(answer.data.error) || 'login_failed', reason: text(answer.data.detail).slice(0, 500) };
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
