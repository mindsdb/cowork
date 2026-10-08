// The shared browser (ENG-3299): the agent opened the user's MindsHub browser
// and the chat shows its live viewer beside the conversation.
//
// The server sends `response.browser_session_opened {session_id, view_url,
// expires_at}`. It becomes a `Browser` step on the turn, so it persists and
// replays with the conversation like an artifact card. `view_url` is an
// embed URL the edge only honours for an hour, so a reopened conversation
// asks the server for a fresh one (POST /browse/embed) instead of trusting it.

export const BROWSER_BADGE = 'Browser';

// Only a hosted browser instance may be framed: the same hosts the CSP lists.
const FRAMABLE_HOST = /^br-[a-z0-9-]+\.(?:[a-z0-9-]+\.)*(?:4nton\.ai|mindshub\.ai)$/;

export function isFramableViewUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && FRAMABLE_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

// Reducer half: the step a `response.browser_session_opened` event adds, or
// null when the event is unusable. One step per session per turn: a second
// event for the same session (the tool re-opening it) refreshes the URL.
export function browserStep(event, eventTs) {
  const sessionId = typeof event?.session_id === 'string' && event.session_id ? event.session_id : '';
  const viewUrl = event?.view_url;
  if (!sessionId || !isFramableViewUrl(viewUrl)) return null;
  const expiresAt = Number.isFinite(event.expires_at) ? event.expires_at : 0;
  return {
    id: `browser-${sessionId}`,
    label: 'Opened the browser',
    badge: BROWSER_BADGE,
    icon: 'globe',
    status: 'completed',
    startedAt: eventTs,
    completedAt: eventTs,
    data: { sessionId, viewUrl, expiresAt },
    output: null,
    result: null,
    _isScratchpad: false,
    _scratchpadTabId: null,
  };
}

export function withBrowserStep(steps, step) {
  const at = steps.findIndex((s) => s.badge === BROWSER_BADGE && s.data?.sessionId === step.data.sessionId);
  if (at === -1) return [...steps, step];
  const next = steps.slice();
  next[at] = { ...steps[at], data: step.data, completedAt: step.completedAt };
  return next;
}

// The browser session the chat should show: the newest Browser step across
// the conversation, streaming turn last. `key` changes when a newer turn opens
// the browser again, so a pane the user closed comes back for the new one.
export function latestBrowserSession(messages, streamingMsg) {
  const lists = [...(messages || []).map((m, i) => [m?.steps, `m${i}`]), [streamingMsg?.steps, 'live']];
  for (let i = lists.length - 1; i >= 0; i -= 1) {
    const [steps, where] = lists[i];
    const step = (steps || []).slice().reverse().find((s) => s?.badge === BROWSER_BADGE && s.data?.sessionId);
    if (step) {
      const { sessionId, viewUrl, expiresAt } = step.data;
      return { key: `${where}:${sessionId}`, sessionId, viewUrl, expiresAt };
    }
  }
  return null;
}

// True when a URL is too close to (or past) its expiry to load. A minute of
// slack so it doesn't expire between the check and the iframe loading.
export function needsFreshViewUrl(session, nowMs = Date.now()) {
  if (!session?.viewUrl) return true;
  if (!session.expiresAt) return false;
  return session.expiresAt * 1000 - 60_000 <= nowMs;
}
