/*
 * Whether the person's own live apps are running, for the state line on a
 * full-stack app card. cowork-server keeps one record per launch and writes
 * the stop and its reason onto it, and `GET /live-apps/mine` answers the
 * caller's apps only, so a card never learns about anyone else's app. A stop
 * is explained, never a bare error: the line says when the app stopped and
 * why, in the server's words, so the idle and maximum times stay the
 * operator's settings. Times are UTC and say so, as the app's stopped page and
 * the agent's turn line give them.
 */

import { isBackendArtifact } from './artifactKinds';
import { receivedFromLine } from './liveAppSharing';

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

/**
 * The two lines a live app's card carries, each null when it has none.
 *
 * @typedef {object} LiveAppLines
 * @property {string | null} state "Live at …" or "Stopped …".
 * @property {string | null} received "Received from …" on a duplicated app.
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

/*
 * Built from UTC fields with a fixed month table, not Intl, so the card reads
 * exactly as cowork-server's strftime does ("Sep", never a locale's "Sept")
 * in every browser and zone.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utcDay = (at) => at.toISOString().slice(0, 10);

/** "12:04 UTC" for a stop on today's UTC date, "19 Oct 12:04 UTC" for an older one. */
function stopTime(iso, now) {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return '';
  const time = `${at.toISOString().slice(11, 16)} UTC`;
  if (utcDay(at) === utcDay(now)) return time;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${time}`;
}

/** The address as a person types it: host and port, e.g. app1.view.localhost:8080. */
function hostOf(address) {
  try {
    return new URL(address).host;
  } catch {
    return '';
  }
}

/**
 * The card's state line: "Live at app1.view.localhost:8080", or
 * "Stopped 12:04 UTC, no requests for 2 h. Ask your agent to relaunch it."
 * Null for an app with no launch on record.
 *
 * @param {LiveAppState | undefined} state
 * @param {{ now?: Date }} [options] The current time, for tests.
 */
export function liveAppStateLine(state, { now = new Date() } = {}) {
  if (!state) return null;
  if (state.state === 'running') {
    const host = hostOf(state.address);
    return host ? `Live at ${host}` : 'Live';
  }
  const when = stopTime(state.stoppedAt, now);
  const reason = state.stopReasonText.trim();
  const stopped = ['Stopped', when].filter(Boolean).join(' ');
  return `${reason ? `${stopped}, ${reason}` : stopped}. Ask your agent to relaunch it.`;
}

/**
 * A card's live-app lines, or null for a card that has none: live apps are
 * off, or it isn't a full-stack app. The rail and the Live Artifacts page both
 * read them here, so the two never disagree about when a line shows.
 *
 * @param {object} artifact An artifact card.
 * @param {{ liveApps: boolean, states: Map<string, LiveAppState> }} context
 * @returns {LiveAppLines | null}
 */
export function liveAppLines(artifact, { liveApps, states }) {
  if (!liveApps || !isBackendArtifact(artifact)) return null;
  return {
    state: liveAppStateLine(states.get(liveAppKey(artifact.projectId, artifact.slug))),
    received: receivedFromLine(artifact),
  };
}
