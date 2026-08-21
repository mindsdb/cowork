// Pure selection logic for the per-task message queue drain (ENG-1378).
//
// Sending is serialized globally — anton-core runs one turn at a time —
// but the queue of messages a user fires mid-turn is keyed per task
// ({ [taskId]: item[] }). After a turn ends the drain must sweep *every*
// task's queue, not just the finishing task's: a message queued for a
// conversation the user navigated away from would otherwise strand
// forever showing "N queued · waiting for <agent>".
//
// Given the queues map, the set (or list) of task ids that still exist,
// and the id of the task whose turn just finished, decide which task's
// queue should drain next. The finishing task is preferred so its own
// follow-up messages keep FIFO order; a queue whose task no longer
// exists (deleted or merged mid-flight) is skipped rather than wedging
// the drain loop.
export function selectNextQueuedTask(queues, existingTaskIds, preferredTaskId) {
  const exists = existingTaskIds instanceof Set
    ? (id) => existingTaskIds.has(id)
    : (id) => Array.isArray(existingTaskIds) && existingTaskIds.includes(id);
  const hasQueue = (id) =>
    Array.isArray(queues?.[id]) && queues[id].length > 0 && exists(id);

  if (preferredTaskId && hasQueue(preferredTaskId)) return preferredTaskId;
  return Object.keys(queues || {}).find(hasQueue) || null;
}

// Decide whether the single app-wide stream slot is stranded and must be
// force-released. Normally a turn's terminal event (onDone/onError) frees the
// slot; but a stream that dies with NO terminal — a half-open SSE, or a
// reconnect tail attached to a turn that ended elsewhere — leaves the slot
// reserved forever, so every later message strands at "N queued · waiting for
// <agent>" (both text and un-uploaded attachments). The 5s in-flight poll is
// the backstop: `serverInFlightIds` is the authoritative list of conversations
// the server still considers running. If we hold the slot for a task the server
// no longer lists, the reservation is stale.
//
// A single miss is not enough: right after send we mark the task in-flight
// locally before the server has registered the turn, and the tmp->canonical id
// swap briefly points the slot at an id the server never listed. Requiring
// `threshold` consecutive misses (~one per 5s poll) rides out both transients
// without ever aborting a genuinely-running turn. `prev` is the running
// { cid, misses } tally; misses reset whenever the task reappears or the slot
// moves to a different conversation.
//
// `preflight` is the other guard: a send reserves the slot synchronously, then
// awaits attachment uploads before the stream — and the server — ever starts. A
// big upload can outlast `threshold` polls, and during it the server rightly
// doesn't list the turn, so its absence is expected, not a strand. When
// `preflight` is set the tally is held clean and nothing is released; the caller
// detects pre-flight as "slot reserved but no stream controller yet."
//
// Two guards keep this from reaping a HEALTHY turn:
//
//   * `seen` (registration-phase guard). Only a turn we have positively observed
//     in the server's in-flight list can ever be reaped. On the file backend
//     (desktop) `/in-flight-list` reads the in-process RunRegistry, populated
//     synchronously by `registry.start` before the client streams, so a live
//     turn is seen on the first poll. The Redis multi-instance backend merges a
//     shared index written only after (possibly slow) EFS workspace staging, and
//     production runs two replicas — so a poll routed to a lagging replica can
//     report a just-started or not-yet-propagated turn as absent. Refusing to
//     count a miss until the turn has been seen means such a false-negative
//     cannot abort a healthy turn: this path only ever releases a turn the
//     server first listed and later dropped.
//   * miss-spacing (`now` / `minMissSpacingMs`). The 5s interval poll and a
//     window-focus refresh can fire close together, so two absent polls could
//     advance this shared tally back-to-back instead of ~5s apart, collapsing
//     the two-miss window to an instant. A new miss counts only once
//     `minMissSpacingMs` has elapsed since the last, so `threshold` misses
//     always span ~threshold real poll intervals. `now === 0` (the default)
//     disables the spacing guard — used by callers/tests that don't need it.
//
// `preflight` is the third guard: a send reserves the slot synchronously, then
// awaits attachment uploads before the stream — and the server — ever starts. A
// big upload can outlast `threshold` polls, and during it the server rightly
// doesn't list the turn, so its absence is expected, not a strand. When
// `preflight` is set the tally is held clean and nothing is released; the caller
// detects pre-flight as "slot reserved but no stream controller yet."
//
// The tally is `{ cid, misses, seen, lastMissAt }`; misses/seen reset whenever
// the task reappears or the slot moves to a different conversation.
export function reservationReleaseDecision(
  streamingTaskId,
  serverInFlightIds,
  prev,
  { threshold = 2, preflight = false, now = 0, minMissSpacingMs = 4000 } = {},
) {
  if (!streamingTaskId) return { cid: null, misses: 0, seen: false, lastMissAt: 0, release: false };

  const sameCid = Boolean(prev) && prev.cid === streamingTaskId;
  const priorMisses = sameCid ? (prev.misses || 0) : 0;
  const priorSeen = sameCid ? Boolean(prev.seen) : false;
  const priorLastMissAt = sameCid ? (prev.lastMissAt || 0) : 0;

  // Reserved but not yet streaming: the server has not been told about the turn
  // yet, so hold the tally clean. Preserve `seen` so a mid-turn pre-flight
  // window can't erase that we already confirmed the turn.
  if (preflight) {
    return { cid: streamingTaskId, misses: 0, seen: priorSeen, lastMissAt: 0, release: false };
  }

  const ids = Array.isArray(serverInFlightIds) ? serverInFlightIds : [];
  if (ids.includes(streamingTaskId)) {
    // Present: registration confirmed. Reset the tally and mark it seen, so a
    // later disappearance counts as a genuine strand.
    return { cid: streamingTaskId, misses: 0, seen: true, lastMissAt: 0, release: false };
  }

  // Absent. Registration-phase guard: never reap a turn we have not yet seen.
  if (!priorSeen) {
    return { cid: streamingTaskId, misses: 0, seen: false, lastMissAt: priorLastMissAt, release: false };
  }

  // Miss-spacing guard: don't let a second poll within the spacing window count
  // a fresh miss on top of the last one.
  if (now && priorMisses > 0 && now - priorLastMissAt < minMissSpacingMs) {
    return { cid: streamingTaskId, misses: priorMisses, seen: true, lastMissAt: priorLastMissAt, release: priorMisses >= threshold };
  }

  const misses = priorMisses + 1;
  return { cid: streamingTaskId, misses, seen: true, lastMissAt: now, release: misses >= threshold };
}

// Re-key queued messages when the server mints a canonical id for a task
// that was streaming under a tmp id (adoptServerId, ENG-1378). Moves every
// source id's queue onto `toId`, preserving FIFO order (existing `toId`
// items first, then the sources in the given order). Falsy source ids and any
// source equal to `toId` are ignored. Returns the input map unchanged when
// nothing moves, so the React setState no-ops instead of re-rendering.
export function mergeQueuesForAdoptedId(queues, fromIds, toId) {
  // A falsy `toId` would write an unreachable `next[undefined]` key and strand
  // every moved message — the ENG-1378 symptom. The one caller (adoptServerId)
  // already guards against it; keep the pure fn safe on its own too.
  if (!toId) return queues;
  const keys = [...new Set((fromIds || []).filter(Boolean))].filter((k) => k !== toId);
  const pending = keys.flatMap((k) => queues?.[k] || []);
  if (pending.length === 0) return queues;
  const next = { ...queues };
  keys.forEach((k) => delete next[k]);
  next[toId] = [...(next[toId] || []), ...pending];
  return next;
}
