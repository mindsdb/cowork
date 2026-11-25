// How many comment threads are still open on each of the caller's own
// artifacts, for the Artifacts page's counters (ENG-4560).
//
// No route answers this for a list: comments are read one artifact at a time
// (GET /artifact-comments/{userDir}/{reportId}/threads), from the local journal
// on Desktop and through cowork-server's proxy in MindsHub mode. So this asks
// that route with `status=open` for each artifact the page shows that the
// caller owns and that can hold comments, a few at a time and after the list
// has painted. Open here means what the viewer's rail badge counts: neither
// resolved nor dismissed.
//
// Answers are kept for the session, keyed by the artifact's comment key and its
// mtime, so moving between pages or filters asks nothing again. A failed read
// (comments never switched on for a MindsHub draft, a session that expired, a
// dropped connection) is kept as "unknown", which draws no counter: the list
// must not keep asking for something it was refused. `forgetOpenCommentCount`
// reads one artifact again, for when its comments may have changed (the viewer
// was open on it).

import { useEffect, useMemo, useState } from 'react';
import { listCommentThreads } from '../api';
import { artifactCommentsKey, artifactIdentity } from '../lib/artifactIdentity';
import { documentPreviewType } from '../preview/kinds';

const CONCURRENCY = 4;
const UNKNOWN = null;

// One store for the page's lifetime and past it: answers, reads queued or under
// way, and the mounted lists waiting on them. At most CONCURRENCY reads are out
// at once, however many lists ask.
const memory = new Map();
// Forgotten answers, still drawn until the new read lands, so a counter does
// not blink out and back after the viewer closes.
const stale = new Map();
const inFlight = new Set();
const waiting = [];
const listeners = new Set();
let active = 0;

function notify() {
  for (const listener of listeners) listener();
}

function pump() {
  while (active < CONCURRENCY && waiting.length) {
    const { key, artifact } = waiting.shift();
    // Nobody is showing a list any more: drop the read, ask again on return.
    if (!listeners.size) { inFlight.delete(key); continue; }
    active += 1;
    read(key, artifact).finally(() => {
      active = Math.max(0, active - 1);
      pump();
    });
  }
}

async function read(key, artifact) {
  const [userDir, ...rest] = commentKeyOf(artifact).split('/');
  try {
    const data = await listCommentThreads(userDir, rest.join('/'), 'open');
    memory.set(key, openThreadCount(data?.threads));
  } catch {
    memory.set(key, UNKNOWN);
  } finally {
    inFlight.delete(key);
    stale.delete(key);
  }
  notify();
}

function request(artifact) {
  const key = cacheKeyOf(artifact);
  if (!key || memory.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  waiting.push({ key, artifact });
}

/** The comment key the viewer would use for this card, or ''. */
export function commentKeyOf(artifact) {
  return artifact?.artifactKey || artifactCommentsKey(artifactIdentity(artifact));
}

function cacheKeyOf(artifact) {
  const key = commentKeyOf(artifact);
  return key ? `${key}|${artifact?.mtime || ''}` : '';
}

/**
 * Whether the list should count this card's open comments: the caller's own
 * (no reviewer role), with a comment key, and not a document the viewer shows
 * read-only without comments (.xlsx, .docx, .pptx, .pdf).
 */
export function countsOpenComments(artifact) {
  if (!artifact || artifact.capabilities?.role === 'reviewer') return false;
  if (!commentKeyOf(artifact)) return false;
  return documentPreviewType(artifact) === null;
}

/** Open threads in a list answer: neither resolved nor dismissed. */
export function openThreadCount(threads) {
  return (threads || []).filter((t) => t?.status !== 'resolved' && t?.status !== 'dismissed').length;
}

/** Reads one artifact again on the next pass; its last answer shows until then. */
export function forgetOpenCommentCount(artifact) {
  const key = commentKeyOf(artifact);
  if (!key) return;
  for (const [cached, count] of [...memory.entries()]) {
    if (!cached.startsWith(`${key}|`)) continue;
    memory.delete(cached);
    stale.set(cached, count);
  }
}

/** For tests: forget every answer and every queued read. */
export function resetOpenCommentCounts() {
  memory.clear();
  stale.clear();
  inFlight.clear();
  waiting.length = 0;
  active = 0;
}

/**
 * The open comment count per artifact, as a lookup: a number once read, or
 * null while unknown (not read yet, not eligible, or the read failed).
 * @param {object[]} list  the artifacts the page shows, top first
 * @param {{ enabled?: boolean, refresh?: unknown }} [options]  `refresh`: a
 *   value that, when it changes, reads again whatever was forgotten meanwhile.
 * @returns {(artifact: object) => number | null}
 */
export function useOpenCommentCounts(list, { enabled = true, refresh } = {}) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  // After the list paints: queue a read for each eligible card not known yet.
  useEffect(() => {
    if (!enabled) return;
    for (const artifact of list || []) if (countsOpenComments(artifact)) request(artifact);
    pump();
  }, [enabled, list, refresh]);

  return useMemo(() => (artifact) => {
    if (!enabled || !countsOpenComments(artifact)) return null;
    const key = cacheKeyOf(artifact);
    const count = memory.has(key) ? memory.get(key) : stale.get(key);
    return typeof count === 'number' ? count : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, version]);
}

export default useOpenCommentCounts;
