// Preview checks (ENG-4207): the agent, mid-turn, asks whether an artifact it
// just edited runs in the preview the user has open. The server sends
// `response.artifact_check { check_id, artifact_slug, timeout_s }` on the
// conversation stream and waits for POST /artifacts/checks/{check_id}.
//
// This module is the app-wide half: open artifact viewers register here by
// slug (usePreviewCheckTarget), and every stream hands its events to
// handleArtifactCheckEvent before the reducer. The event is never a chat step.
//
// Every check is answered exactly once, whatever happens: no viewer for the
// slug, the viewer closing mid-check, or the check outliving its timeout all
// answer "unavailable", which tells the agent "not verified" at once instead
// of making it wait out the timeout.

import { submitArtifactCheck } from '../api';

export const ARTIFACT_CHECK_EVENT = 'response.artifact_check';

// Quiet time after the reloaded preview's load event: errors from a page's
// first timers, fetches and promise chains land after load.
export const SETTLE_MS = 3000;

// Kept clear of the server's own deadline, so an answer still lands in time.
const DEADLINE_MARGIN_MS = 1000;
const DEFAULT_TIMEOUT_S = 30;

// Check ids already taken. A /tail reconnect replays the stream from seq 0,
// so the same check arrives again; it must not reload the preview twice or
// answer twice. Bounded: ids are per check, never reused.
const MAX_REMEMBERED = 500;
const taken = new Set();

// slug → the newest registration for it. One preview per slug is on screen at
// a time; when two viewers do mount, the later one is the one being looked at.
const targets = new Map();

/**
 * @typedef {object} PreviewCheckTarget
 * @property {(opts: { deadlineMs: number }) => Promise<{ status: 'passed' | 'failed' | 'unavailable', errors?: object[] }>} run
 *   Reload the preview, wait for load and settle, and report what it saw.
 */

/**
 * Register the preview of `slug` as able to answer checks. Returns the
 * unregister function; a check still running when it is called answers
 * "unavailable".
 *
 * @param {string} slug
 * @param {PreviewCheckTarget} target
 */
export function registerPreviewCheckTarget(slug, target) {
  if (!slug || !target || typeof target.run !== 'function') return () => {};
  let release;
  const gone = new Promise((resolve) => { release = resolve; });
  const entry = { target, gone };
  targets.set(slug, entry);
  return () => {
    release();
    if (targets.get(slug) === entry) targets.delete(slug);
  };
}

/** The check a stream event asks for, or null for any other event. */
export function parseArtifactCheck(ev) {
  if (!ev || ev.type !== ARTIFACT_CHECK_EVENT) return null;
  const checkId = typeof ev.check_id === 'string' ? ev.check_id : '';
  const slug = typeof ev.artifact_slug === 'string' ? ev.artifact_slug : '';
  if (!checkId) return null;
  const timeoutS = Number(ev.timeout_s);
  return {
    checkId,
    slug,
    timeoutS: Number.isFinite(timeoutS) && timeoutS > 0 ? timeoutS : DEFAULT_TIMEOUT_S,
  };
}

function remember(checkId) {
  if (taken.size >= MAX_REMEMBERED) taken.delete(taken.values().next().value);
  taken.add(checkId);
}

async function answer(submit, checkId, body) {
  try {
    await submit(checkId, body);
  } catch {
    // The server times the check out on its own; nothing to do here.
  }
}

/**
 * Run the check one stream event asks for. Returns true when the event was a
 * check (handled or a replayed duplicate), so the caller can skip it.
 * The returned value never waits on the check itself.
 *
 * @param {object} ev
 * @param {{ submit?: typeof submitArtifactCheck, now?: () => number }} [deps]
 */
export function handleArtifactCheckEvent(ev, { submit = submitArtifactCheck, now = Date.now } = {}) {
  if (!ev || ev.type !== ARTIFACT_CHECK_EVENT) return false;
  const check = parseArtifactCheck(ev);
  if (!check || taken.has(check.checkId)) return true;
  remember(check.checkId);
  // A check replayed after its timeout (the app reloaded mid-turn and the
  // stream replayed from the start) was already given up on by the server:
  // reloading the preview for it would be for nobody.
  if (typeof ev.at_ms === 'number' && now() > ev.at_ms + check.timeoutS * 1000) return true;
  void runCheck(check, submit, now);
  return true;
}

/**
 * Answer a check that arrived on another stream than a conversation's: a
 * quick edit's `check_request` (ENG-4227) carries the same
 * `{ check_id, artifact_slug, timeout_s }` and is answered the same way, by
 * the open viewer for that slug, through the same POST. Resolves to the
 * status answered ('passed' | 'failed' | 'unavailable'; the first two mean
 * the preview was reloaded and checked), or null for a duplicate or an
 * unreadable request; never rejects.
 *
 * @param {{ check_id?: string, artifact_slug?: string, timeout_s?: number }} data
 * @param {{ submit?: typeof submitArtifactCheck, now?: () => number }} [deps]
 */
export async function answerArtifactCheck(data, { submit = submitArtifactCheck, now = Date.now } = {}) {
  const check = parseArtifactCheck({ ...(data || {}), type: ARTIFACT_CHECK_EVENT });
  if (!check || taken.has(check.checkId)) return null;
  remember(check.checkId);
  return runCheck(check, submit, now);
}

async function runCheck({ checkId, slug, timeoutS }, submit, now) {
  const startedAt = now();
  const entry = targets.get(slug);
  if (!entry) {
    await answer(submit, checkId, { status: 'unavailable', errors: [], ms: 0 });
    return 'unavailable';
  }
  const budgetMs = Math.max(0, timeoutS * 1000 - DEADLINE_MARGIN_MS);
  let timer;
  const unavailable = { status: 'unavailable', errors: [] };
  const outcome = await Promise.race([
    Promise.resolve()
      .then(() => entry.target.run({ deadlineMs: startedAt + budgetMs }))
      .catch(() => unavailable),
    entry.gone.then(() => unavailable),
    new Promise((resolve) => { timer = setTimeout(() => resolve(unavailable), budgetMs); }),
  ]);
  clearTimeout(timer);
  const status = ['passed', 'failed', 'unavailable'].includes(outcome?.status) ? outcome.status : 'unavailable';
  const errors = status === 'failed' && Array.isArray(outcome.errors) ? outcome.errors : [];
  await answer(submit, checkId, { status, errors, ms: Math.max(0, Math.round(now() - startedAt)) });
  return status;
}

/** Test helper: forget every registration and every check id taken. */
export function _resetArtifactChecks() {
  taken.clear();
  targets.clear();
}
