/*
 * Whether the person's own live apps are running, for the state line on a
 * full-stack app card. cowork-server keeps one record per launch and per stop,
 * and `GET /live-apps/mine` answers the caller's apps only, so a card never
 * learns about anyone else's app. A stop is explained, never a bare error:
 * the line says when the app stopped and why, in the server's words, so the
 * idle and maximum times stay the operator's settings.
 */

/**
 * One app of the caller's, as `GET /live-apps/mine` lists it.
 *
 * @typedef {object} LiveAppState
 * @property {string} projectId
 * @property {string} slug
 * @property {'running' | 'stopped'} state
 * @property {string} address The app's own address, e.g. http://app1.view.localhost:8080/
 * @property {string} stoppedAt ISO 8601, empty while running
 * @property {string} stopReasonText The server's reason, e.g. "no requests for 2 h"
 */

/** The key that matches a state to its artifact card. */
export function liveAppKey(projectId, slug) {
  return `${projectId ?? ''}/${slug ?? ''}`;
}

/**
 * The states as the server sent them, keyed for the cards. Entries the cards
 * can't match, or in a state the client doesn't know, are left out.
 *
 * @param {unknown} data
 * @returns {Map<string, LiveAppState>}
 */
export function liveAppStatesFrom(data) {
  const states = new Map();
  if (!Array.isArray(data)) return states;
  for (const item of data) {
    if (!item || !item.projectId || !item.slug) continue;
    if (item.state !== 'running' && item.state !== 'stopped') continue;
    states.set(liveAppKey(item.projectId, item.slug), {
      projectId: String(item.projectId),
      slug: String(item.slug),
      state: item.state,
      address: String(item.address ?? ''),
      stoppedAt: String(item.stoppedAt ?? ''),
      stopReasonText: String(item.stopReasonText ?? ''),
    });
  }
  return states;
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function clockTime(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : CLOCK.format(at);
}

function hostOf(address) {
  try {
    return new URL(address).hostname;
  } catch {
    return '';
  }
}

/**
 * The card's state line: "Live at app1.view.localhost", or
 * "Stopped 12:04, no requests for 2 h. Ask your agent to relaunch it."
 * Null for an app with no launch on record.
 *
 * @param {LiveAppState | undefined} state
 */
export function liveAppStateLine(state) {
  if (!state) return null;
  if (state.state === 'running') {
    const host = hostOf(state.address);
    return host ? `Live at ${host}` : 'Live';
  }
  const when = clockTime(state.stoppedAt);
  const reason = state.stopReasonText.trim();
  const stopped = ['Stopped', when].filter(Boolean).join(' ');
  return `${reason ? `${stopped}, ${reason}` : stopped}. Ask your agent to relaunch it.`;
}
