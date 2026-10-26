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
import { canShareLiveApp, isLiveAppCard, receivedFromLine } from './liveAppSharing';

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

/** The address when it is an http(s) URL, else ''. It is opened in a new tab. */
function httpAddress(address) {
  try {
    const url = new URL(address);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * What a live app's viewer shows in place of a preview, and what its open
 * controls open. A live app runs only at its own address: the deployment
 * refuses the in-Cowork preview, and the serve route's copy of its page has no
 * backend. So while the app runs the viewer names that address, and
 * otherwise says why it isn't running and what to do, as the card says it.
 *
 * `address` is the running app's http(s) address, or '' when there is
 * nothing to open. `canLaunch` is whether the app is known not to run, so the
 * viewer offers Launch. Null until the read answers.
 *
 * @param {{ status: 'off' | 'loading' | 'ready' | 'failed', state?: LiveAppState }} read
 * @param {{ now?: Date }} [options] The current time, for tests.
 * @returns {{ address: string, text: string, canLaunch: boolean } | null}
 */
export function liveAppViewerNotice(read, { now = new Date() } = {}) {
  if (read.status === 'failed') {
    return { address: '', text: "Couldn't check whether this app is running. Reload to try again.", canLaunch: false };
  }
  if (read.status !== 'ready') return null;
  const { state } = read;
  if (state?.state === 'running') {
    const address = httpAddress(state.address);
    return address
      ? { address, text: 'This live app runs at its own address.', canLaunch: false }
      : { address: '', text: 'This live app is running. Ask your agent for its address.', canLaunch: false };
  }
  if (state?.state === 'stopped') return { address: '', text: liveAppStateLine(state, { now }), canLaunch: true };
  return { address: '', text: "This live app isn't running. Ask your agent to launch it.", canLaunch: true };
}

export const LAUNCH_LIVE_APP_LABEL = 'Launch';

/**
 * What Launch asks the agent, in a chat of the app's project: the agent
 * launches it behind the usual card, so the person approves it as before.
 *
 * @param {{ slug?: string } | null | undefined} artifact
 */
export function launchLiveAppPrompt(artifact) {
  return `Launch the live app \`${artifact?.slug || ''}\`.`;
}

/**
 * Whether a card offers Launch: the viewer's own full-stack app, on a
 * deployment that runs live apps, that isn't running.
 *
 * @param {object} artifact An artifact card.
 * @param {{ liveApps: boolean, states: Map<string, LiveAppState> }} context
 */
export function canLaunchLiveApp(artifact, { liveApps, states }) {
  return canShareLiveApp(artifact, liveApps)
    && states.get(liveAppKey(artifact.projectId, artifact.slug))?.state !== 'running';
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

/**
 * Where an open control outside the viewer opens a live app: the running
 * app's http(s) address, or '' when there is nothing to open, so the control
 * hides. The serve route's copy of the page has no backend, so it is never
 * the fallback. '' too for a card that isn't an unpublished live app
 * (isLiveAppCard), whose controls keep their own target.
 *
 * @param {object} artifact An artifact card.
 * @param {{ liveApps: boolean, states: Map<string, LiveAppState> }} context
 */
export function liveAppOpenAddress(artifact, { liveApps, states }) {
  if (!isLiveAppCard(artifact, liveApps)) return '';
  const state = states.get(liveAppKey(artifact.projectId, artifact.slug));
  return state?.state === 'running' ? httpAddress(state.address) : '';
}
