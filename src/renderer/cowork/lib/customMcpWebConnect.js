// The web half of adding a custom MCP server by URL: the sign-in pop-up, the
// finish page's report, the status poll, and reading cowork-server's answers
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
// The finish page tells the waiting tab how the sign-in ended: only that page holds auth's code
// and message, and the pop-up's opener is cut. Same origin only. The message names no sign-in,
// so with two tabs each mid sign-in, a tab can take the other's result.
export const CUSTOM_MCP_SIGN_IN_CHANNEL = 'cowork:custom-mcp-sign-in';
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
 * The finish page's report as the wait reads it, or null for anything else on the channel.
 *
 * @param {unknown} data
 * @returns {{ok: true} | {ok: false, code: string, reason: string} | null}
 */
export function readFinishReport(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.ok === true) return { ok: true };
  if (data.ok !== false || typeof data.code !== 'string' || !/^[a-z0-9_]{1,64}$/.test(data.code)) return null;
  return { ok: false, code: data.code, reason: typeof data.reason === 'string' ? data.reason.slice(0, 500) : '' };
}

/**
 * Tells the tab waiting on this sign-in how it ended. Without the channel the
 * tab still learns it from the status poll, so a failed post is left to that.
 *
 * @param {{ok: boolean, code?: string, reason?: string}} result
 * @param {typeof BroadcastChannel | undefined} [Channel]
 */
export function reportCustomMcpFinish(result, Channel = globalThis.BroadcastChannel) {
  const channel = openChannel(Channel);
  if (!channel) return;
  try {
    channel.postMessage(result.ok ? { ok: true } : { ok: false, code: result.code, reason: result.reason || '' });
  } catch { /* the status poll still ends the wait */ } finally {
    channel.close();
  }
}

/**
 * Opens an empty pop-up for the sign-in. Call it inside the click, before any
 * await, or the browser blocks it. Its opener is cut at once, so the login
 * page gets no handle on this tab.
 *
 * Listens for the finish page's report from now on.
 *
 * @param {Window} [win]
 * @param {typeof BroadcastChannel | undefined} [Channel]
 * @returns {{popup: Window | null, cancelled: boolean, whenCancelled: Promise<typeof CANCELLED>,
 *   whenReported: Promise<{ok: true} | {ok: false, code: string, reason: string}>, keepPopup: boolean}}
 */
export function beginCustomMcpSignIn(win = window, Channel = globalThis.BroadcastChannel) {
  let popup = null;
  try { popup = win.open('', '_blank'); } catch { popup = null; }
  if (popup) {
    try { popup.opener = null; } catch { /* a closed pop-up */ }
  }
  let cancel = () => {};
  const whenCancelled = new Promise((resolve) => { cancel = () => resolve(CANCELLED); });
  let report = () => {};
  const whenReported = new Promise((resolve) => { report = resolve; });
  const channel = openChannel(Channel);
  if (channel) {
    channel.onmessage = (event) => {
      const reported = readFinishReport(event.data);
      if (reported) report(reported);
    };
  }
  const signIn = { popup, cancelled: false, whenCancelled, cancel, whenReported, channel, keepPopup: false };
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

/** Ends the sign-in: stops listening and closes its pop-up, unless the pop-up
 *  shows the finish page's failure, which the member closes. */
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
 * Waits for the sign-in to end: the finish page's report, or else the status
 * poll, for a sign-in that never reaches that page. A reported failure ends
 * the wait with the page's own code and message and keeps the pop-up open; a
 * reported success reads the status at once, for the details a success shows.
 * Each status request is sent only after the previous one answered. A
 * timed-out, unanswered or transiently refused poll is retried until the
 * overall deadline.
 *
 * @param {{cancelled: boolean, whenCancelled: Promise<typeof CANCELLED>,
 *   whenReported?: Promise<{ok: boolean, code?: string, reason?: string}>, keepPopup?: boolean}} signIn
 * @param {() => Promise<{ok: true, data: any} | {ok: false, code: string, reason: string}>} readStatus never rejects
 * @param {{sleep?: (ms: number) => Promise<void>, now?: () => number}} [options]
 * @returns {Promise<{ok: true, data: any} | {ok: false, code: string, reason: string}>}
 */
export async function pollCustomMcpSignIn(signIn, readStatus, { sleep = wait, now = Date.now } = {}) {
  const deadline = now() + CUSTOM_MCP_SIGN_IN_MS;
  let reported = null;
  let wake = Promise.race([signIn.whenCancelled, (signIn.whenReported ?? NEVER).then((report) => { reported = report; })]);
  while (now() < deadline) {
    await Promise.race([sleep(CUSTOM_MCP_POLL_MS), wake]);
    if (signIn.cancelled) return CANCELLED;
    if (reported && !reported.ok) {
      signIn.keepPopup = true;
      return reported;
    }
    // A reported success wakes the wait once; later reads keep the poll's pace.
    if (reported) wake = signIn.whenCancelled;
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
