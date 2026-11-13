import i18n from '../../lib/i18n';

const tr = (key, vars) => i18n.t(`messages.browserSession.${key}`, { ns: 'projects', ...vars });
/* The shared browser: the agent opened the person's browser, and on the web
   the chat shows its live viewer beside the conversation.

   The server sends `response.browser_session_opened {session_id}`. It becomes
   a `Browser` step on the turn, so it persists and replays with the
   conversation like an artifact card. The step keeps the session id alone:
   the web pane mints its own viewer link through POST /browse/embed each time
   it shows the viewer, because the browser router honors a link once. */

export const BROWSER_BADGE = 'Browser';

// A session id, as the browser router and the agent's browser tool accept it.
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/* The router's viewer page for one session. The router is served under
   /browser on the app's own origin, which index-web.html's frame-src 'self'
   already allows. */
const VIEWER_PATH = /^\/browser\/sessions\/[A-Za-z0-9_-]{1,64}\/view$/;

/**
 * Whether the web pane may frame `url`: the router's viewer page for one
 * session, on the app's own origin, with no user name or password in it.
 *
 * @param {unknown} url
 * @param {string} [appOrigin]
 * @returns {boolean}
 */
export function isFramableViewUrl(url, appOrigin = window.location.origin) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === appOrigin
    && !parsed.username
    && !parsed.password
    && VIEWER_PATH.test(parsed.pathname);
}

/* The shortest renewal the pane schedules. The router's lease runs 780 s past
   its ticket's redeem-by time today; an answer whose lease ends sooner than
   this after it gets no renewal. */
export const MIN_RENEW_AFTER_MS = 60_000;

/**
 * A viewer link the pane may use: the address to frame, the ticket in it (its
 * `et`), which a viewer that takes tickets in place redeems over its port, and
 * how long after the fetch the pane asks for the next ticket.
 *
 * @typedef {{ viewUrl: string, ticket: string, renewAfterMs: number | null }} ViewerLink
 */

/**
 * The viewer link in a POST /browse/embed answer, or null when the pane must
 * not use it: an address off the app's viewer path, a viewer for another
 * session than the pane's, an address with no ticket, or an answer with no
 * redeem-by time (`ticket_expires_at`). `renewAfterMs` is the lease's length
 * past the redeem-by time (`lease_expires_at - ticket_expires_at`), so a
 * ticket fetched then is redeemed before the lease ends; it is null when the
 * answer has no lease, or one that ends under MIN_RENEW_AFTER_MS after it.
 *
 * @param {import('../api').BrowserEmbed | null | undefined} answer
 * @param {string} sessionId  The session the pane shows.
 * @param {string} [appOrigin]
 * @returns {ViewerLink | null}
 */
export function viewerLinkFrom(answer, sessionId, appOrigin = window.location.origin) {
  if (!isFramableViewUrl(answer?.view_url, appOrigin)) return null;
  const url = new URL(answer.view_url);
  if (url.pathname !== `/browser/sessions/${sessionId}/view`) return null;
  if (!Number.isFinite(answer.ticket_expires_at) || answer.ticket_expires_at <= 0) return null;
  const ticket = url.searchParams.get('et');
  if (!ticket) return null;
  const lease = answer.lease_expires_at;
  const renewAfterMs = Number.isFinite(lease) ? (lease - answer.ticket_expires_at) * 1000 : null;
  return {
    viewUrl: answer.view_url,
    ticket,
    renewAfterMs: renewAfterMs !== null && renewAfterMs >= MIN_RENEW_AFTER_MS ? renewAfterMs : null,
  };
}

/* Reducer half: the step a `response.browser_session_opened` event adds, or
   null when the event names no usable session. Any viewer link an older
   event carries is ignored. */
export function browserStep(event, eventTs) {
  const sessionId = typeof event?.session_id === 'string' && SESSION_ID.test(event.session_id) ? event.session_id : '';
  if (!sessionId) return null;
  return {
    id: `browser-${sessionId}`,
    label: tr('opened'),
    badge: BROWSER_BADGE,
    icon: 'globe',
    status: 'completed',
    startedAt: eventTs,
    completedAt: eventTs,
    data: { sessionId },
    output: null,
    result: null,
    _isScratchpad: false,
    _scratchpadTabId: null,
  };
}

/* One step per session per turn: a second event for the same session (the
   tool opening it again) adds nothing. */
export function withBrowserStep(steps, step) {
  const known = steps.some((s) => s.badge === BROWSER_BADGE && s.data?.sessionId === step.data.sessionId);
  return known ? steps : [...steps, step];
}

// The session id of the newest Browser step in one turn's steps, or null.
export function browserSessionIdIn(steps) {
  for (let i = (steps?.length ?? 0) - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.badge === BROWSER_BADGE && step.data?.sessionId) return step.data.sessionId;
  }
  return null;
}

/* Whether any turn of the conversation, the streaming one included, opened
   the browser. */
export function conversationUsedBrowser(messages, streamingMsg) {
  return [...(messages || []), streamingMsg].some((m) => browserSessionIdIn(m?.steps) !== null);
}

/* The newest browser session in the conversation, the streaming turn
   included, or null: what "show the browser" shows. */
export function latestBrowserSessionIdIn(messages, streamingMsg = null) {
  const all = [...(messages || []), streamingMsg];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const id = browserSessionIdIn(all[i]?.steps);
    if (id) return id;
  }
  return null;
}

/* The messages between the pane and the browser's viewer page (viewer.html).
   The browser service owns their names: __fixtures__/browser-viewer/
   messages.json is a byte-for-byte copy of its list, and
   browserSession.test.js pins each name here to it.

   The viewer posts to the pane on window: ready once its script runs, live
   when its current socket got the pod's hello, and closed, with a close
   code, when no live or pending socket is left. Each router refusal of the
   view is a page that posts the closed message too. url, ask and control
   carry the page the viewer shows, a question typed in its address bar, and
   who holds the browser. A viewer that takes tickets in place transfers a
   MessagePort with its ready; the pane posts ticket, pause and focus on that
   port only, so no ticket travels by window.postMessage. The theme alone
   goes to the viewer's window (browserViewerTheme). */
export const VIEWER_READY = 'browser-viewer-ready';
export const VIEWER_LIVE = 'browser-viewer-live';
export const VIEWER_CLOSED = 'browser-viewer-closed';
export const VIEWER_URL = 'browser-viewer-url';
export const VIEWER_ASK = 'browser-viewer-ask';
export const VIEWER_CONTROL = 'browser-viewer-control';
export const VIEWER_TICKET = 'browser-viewer-ticket';
export const VIEWER_PAUSE = 'browser-viewer-pause';
export const VIEWER_FOCUS = 'browser-viewer-focus';
export const VIEWER_THEME = 'browser-theme';

/**
 * What the viewer posts to the pane, on window. The pane's handler reads each
 * message's raw event.data with no model, so this says what each one
 * carries. A ready comes with the MessagePort in event.ports when the viewer
 * takes tickets in place.
 *
 * @typedef {{ type: 'browser-viewer-ready' }
 *   | { type: 'browser-viewer-live' }
 *   | { type: 'browser-viewer-closed', code?: number }
 *   | { type: 'browser-viewer-url', url: string }
 *   | { type: 'browser-viewer-ask', text: string }
 *   | { type: 'browser-viewer-control', holder: 'human' | 'agent', reason?: string }} ViewerToPaneMessage
 */

/**
 * What the pane posts to the viewer on its port. `ticket` is 1 to 4096
 * characters.
 *
 * @typedef {{ type: 'browser-viewer-ticket', ticket: string }
 *   | { type: 'browser-viewer-pause' }
 *   | { type: 'browser-viewer-focus' }} PaneToViewerMessage
 */

/* A connection the viewer lost gets a fresh link for RELINK_WAIT_MS after
   the close, past the router's 105 s deadline for the events stream to
   start. A failed link fetch in that time is tried again after
   RELINK_RETRY_MS, doubling up to RELINK_RETRY_MAX_MS, each delay cut by up
   to half at random. */
export const RELINK_WAIT_MS = 120_000;
export const RELINK_RETRY_MS = 2_000;
export const RELINK_RETRY_MAX_MS = 30_000;

/**
 * Whether a failed POST /browse/embed may succeed if the pane asks again: it
 * got no HTTP answer, or a timeout (408), a rate limit (429), a browser
 * service failure the app's server passes on as 424, or a server failure
 * (5xx). Any other answer, such as 401 for a person signed out or 403 for a
 * browser turned off, is a refusal the pane shows at once.
 *
 * @param {unknown} err  What embedBrowser threw: an api.js RefusalError carries `status`.
 * @returns {boolean}
 */
export function linkMayComeLater(err) {
  const status = /** @type {{ status?: unknown } | null | undefined} */ (err)?.status;
  if (typeof status !== 'number') return true;
  return status === 408 || status === 424 || status === 429 || status >= 500;
}

/* Close codes the pane reads. 4401: the link lapsed or was spent, or the
   viewer's lease ended; the router's starting page also posts it as its own
   link is about to lapse. 4503: no browser slot is free to start one. 4429:
   the person's browser already runs as many tasks as it can. */
export const LEASE_CLOSE_CODE = 4401;
export const NO_BROWSER_SLOT_CLOSE_CODE = 4503;
export const TASK_CAP_CLOSE_CODE = 4429;

/* A viewer that closes this soon after its link was minted never got going:
   the router refused the link, or the browser went away. */
export const QUICK_CLOSE_MS = 10_000;

/**
 * A close's answer: mint a new link, or stop and say why.
 *
 * @typedef {{ remint: true, quickCloses: number }
 *   | { remint: false, quickCloses: number, stop: 'keeps-closing' | 'no-browser-slot' | 'task-cap' }} ViewerCloseAnswer
 */

/**
 * What the pane does when the viewer reports that its connection closed.
 *
 * A viewer that said it was ready and then ran for QUICK_CLOSE_MS gets a new
 * link, and the count of failed opens starts over. Any other close is a
 * failed open, whenever it comes: the first gets a new link and the second
 * in a row stops, so a router that keeps refusing, even slowly, is not asked
 * for links in a loop. One close before ready is not a failure: a 4401 that
 * comes QUICK_CLOSE_MS or more after the mint is the starting page's own
 * link lapsing during a long start, so it gets a new link and counts nothing.
 * A close that says no browser slot is free, or that the person's browser
 * runs as many tasks as it can, stops at once: a new link can't help until
 * something frees up.
 *
 * @param {{ mintedAtMs: number, nowMs: number, quickCloses: number, ready: boolean, code?: unknown }} state
 *   `quickCloses` counts the failed opens since the last working stretch;
 *   `ready` says whether this link's viewer posted VIEWER_READY.
 * @returns {ViewerCloseAnswer}
 */
export function afterViewerClose({ mintedAtMs, nowMs, quickCloses, ready, code }) {
  if (code === NO_BROWSER_SLOT_CLOSE_CODE) return { remint: false, quickCloses, stop: 'no-browser-slot' };
  if (code === TASK_CAP_CLOSE_CODE) return { remint: false, quickCloses, stop: 'task-cap' };
  const late = nowMs - mintedAtMs >= QUICK_CLOSE_MS;
  if (ready && late) return { remint: true, quickCloses: 0 };
  if (!ready && late && code === LEASE_CLOSE_CODE) return { remint: true, quickCloses };
  if (quickCloses === 0) return { remint: true, quickCloses: 1 };
  return { remint: false, quickCloses: quickCloses + 1, stop: 'keeps-closing' };
}

/* The app's theme, in the shape the browser viewer accepts (a
   `browser-theme` postMessage): its toolbar then matches light, dark, any
   skin and a custom accent. `style` is a CSSStyleDeclaration (computed style
   of document.body, where skins and custom themes set their tokens). */
const VIEWER_THEME_TOKENS = {
  bg: '--bg',
  panel: '--surface',
  border: '--line',
  text: '--ink',
  muted: '--ink-3',
  accent: '--accent',
  danger: '--danger',
  human: '--ok',
  font: '--font-sans',
  radius: '--r-sm',
};

export function browserViewerTheme(style, theme) {
  const vars = {};
  for (const [name, token] of Object.entries(VIEWER_THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (value) vars[name] = value;
  }
  return { type: VIEWER_THEME, scheme: theme === 'dark' ? 'dark' : 'light', vars };
}

/* An address the person typed in the browser pane, as the browser takes it:
   http or https with a host, https:// added when they typed none. null for
   anything else (a search, or a scheme such as javascript:). Same rule as the
   server's person_url. */
export function typedUrl(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 4096 || /\s/.test(text)) return null;
  let address = text;
  if (!text.includes('://')) {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:(?!\d)/.test(text)) return null;
    // A bare word ("tacos") is a search; an address has a dot, a port or is localhost.
    if (!/^(localhost|[^/?#]+\.[^/?#]+|[^/?#]+:\d+)([/?#]|$)/i.test(text)) return null;
    address = `https://${text}`;
  }
  try {
    const url = new URL(address);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? address : null;
  } catch {
    return null;
  }
}

/* A page as the app names it in a prompt (a task sent beside the browser,
   the voice call's view of the screen): only its origin, for http or https.
   The path, query and fragment are the site's to choose (a redirect can
   write a whole instruction into a path) and can carry tokens, so they never
   go into what the agent reads as the person's request. '' for anything else. */
export function pageOriginForContext(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return '';
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return '';
  return url.origin;
}

/* The desktop browser's session for a task: anton's own name for it
   (cowork-server's task_session with no person, "t-" and 24 hex of
   sha256(":" + conversation id)), so the person and the agent share tabs. */
export async function desktopTaskSession(conversationId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`:${conversationId}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t-${hex.slice(0, 24)}`;
}

/* The id of the browser Show browser opens off a task (Home, Projects), kept
   in this browser's storage so a reload opens the same one instead of
   another. Kept per signed-in account (`account`, its sub): on the desktop
   the session is named from the id alone, so two people on one machine
   would otherwise share one browser. A fresh id when storage is out. */
const OFF_TASK_BROWSER_KEY = 'cowork.offTaskBrowserId';

export function offTaskBrowserId(allocate, account = '', storage = globalThis.localStorage) {
  const key = account ? `${OFF_TASK_BROWSER_KEY}:${encodeURIComponent(account)}` : OFF_TASK_BROWSER_KEY;
  try {
    const kept = storage?.getItem(key);
    if (kept && /^[A-Za-z0-9_-]{8,128}$/.test(kept)) return kept;
  } catch {
    // Storage blocked: a fresh id for this load.
  }
  const id = allocate();
  try {
    storage?.setItem(key, id);
  } catch {
    // Not kept: the next load opens another.
  }
  return id;
}
