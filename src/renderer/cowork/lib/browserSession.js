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

/**
 * The viewer link in a POST /browse/embed answer, or null when the pane must
 * not frame it: an address off the app's viewer path, a viewer for another
 * session than the pane's, or an answer with no redeem-by time
 * (`ticket_expires_at`). The pane never schedules a mint from either time; it
 * mints again on mount, visibility, network return and the viewer's close
 * message.
 *
 * @param {import('../api').BrowserEmbed | null | undefined} answer
 * @param {string} sessionId  The session the pane shows.
 * @param {string} [appOrigin]
 * @returns {string | null}
 */
export function viewerLinkFrom(answer, sessionId, appOrigin = window.location.origin) {
  if (!isFramableViewUrl(answer?.view_url, appOrigin)) return null;
  if (new URL(answer.view_url).pathname !== `/browser/sessions/${sessionId}/view`) return null;
  if (!Number.isFinite(answer.ticket_expires_at) || answer.ticket_expires_at <= 0) return null;
  return answer.view_url;
}

/* Reducer half: the step a `response.browser_session_opened` event adds, or
   null when the event names no usable session. Any viewer link an older
   event carries is ignored. */
export function browserStep(event, eventTs) {
  const sessionId = typeof event?.session_id === 'string' && SESSION_ID.test(event.session_id) ? event.session_id : '';
  if (!sessionId) return null;
  return {
    id: `browser-${sessionId}`,
    label: 'Opened the browser',
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

/* A viewer that closes this soon after its link was minted never got going:
   the router refused the link, or the browser went away. */
export const QUICK_CLOSE_MS = 10_000;

/**
 * What the pane does when the viewer reports that its connection closed. A
 * close after a working stretch always gets a new link. A quick close gets
 * one too, but a second quick close in a row doesn't, so a router that keeps
 * refusing is not asked for links in a loop.
 *
 * @param {{ mintedAtMs: number, nowMs: number, quickCloses: number }} state
 *   `quickCloses` counts the quick closes since the last working stretch.
 * @returns {{ remint: boolean, quickCloses: number }}
 */
export function afterViewerClose({ mintedAtMs, nowMs, quickCloses }) {
  if (nowMs - mintedAtMs >= QUICK_CLOSE_MS) return { remint: true, quickCloses: 0 };
  return { remint: quickCloses === 0, quickCloses: quickCloses + 1 };
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
  return { type: 'browser-theme', scheme: theme === 'dark' ? 'dark' : 'light', vars };
}
