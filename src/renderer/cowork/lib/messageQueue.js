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
// slot; a stream that dies with NO terminal — a half-open SSE, or a reconnect
// tail attached to a turn that ended elsewhere — leaves it reserved forever, so
// every later message strands at "N queued · waiting for <agent>". The 5s
// in-flight poll is the backstop: `serverInFlightIds` is the authoritative list
// of running conversations, so holding the slot for a task the server no longer
// lists means the reservation is stale.
//
// Three guards keep this from reaping a HEALTHY turn:
//
//   * `seen`: only a turn we have positively observed in the server's list can
//     be reaped. The file backend (desktop) lists a turn synchronously before
//     the client streams, so it is seen on the first poll; but the Redis backend
//     writes its shared index only after (possibly slow) EFS staging, and prod
//     runs two replicas — so a poll to a lagging replica can report a live
//     just-started turn as absent. Never counting a miss until the turn is seen
//     means this only ever releases a turn the server listed and then dropped.
//   * miss-spacing (`now`/`minMissSpacingMs`): the 5s interval and a focus
//     refresh can fire close together, so two absent polls could advance the
//     tally back-to-back instead of ~5s apart, collapsing the release window. A
//     miss counts only once `minMissSpacingMs` has elapsed since the last, so
//     `threshold` misses span ~threshold poll intervals. `now === 0` (default)
//     disables it, for callers/tests that don't need it.
//   * `preflight`: a send reserves the slot synchronously, then awaits
//     attachment uploads before the stream (and the server's record of it)
//     start. A big upload can outlast `threshold` polls; its absence is expected,
//     not a strand, so the tally is held clean. The caller detects pre-flight as
//     "slot reserved but no stream controller yet."
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

  // Hold the tally clean, but preserve `seen` so a mid-turn upload window can't
  // erase that we already confirmed the turn.
  if (preflight) {
    return { cid: streamingTaskId, misses: 0, seen: priorSeen, lastMissAt: 0, release: false };
  }

  const ids = Array.isArray(serverInFlightIds) ? serverInFlightIds : [];
  if (ids.includes(streamingTaskId)) {
    // Present: registration confirmed. Reset and mark seen, so a later
    // disappearance counts as a genuine strand.
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
