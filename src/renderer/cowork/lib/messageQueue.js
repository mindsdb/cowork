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
// force-released. Normally a turn's terminal event (onDone/onError) frees it; a
// stream that dies with NO terminal — a half-open SSE, or a reconnect tail on a
// turn that ended elsewhere — leaves it reserved forever, stranding every later
// message at "N queued". `serverInFlightIds` is the authoritative running list,
// so holding the slot for a task the server no longer lists means it's stale.
//
// Four guards keep a HEALTHY turn from being aborted while still recovering a
// genuinely stranded one:
//
//   * `seen` sets the threshold (not a gate): a turn the server listed and then
//     dropped is high-confidence, released after `threshold` (2) spaced misses;
//     one never observed waits for the wider `unseenThreshold` (4), since a
//     lagging Redis replica can briefly report a live just-started turn as
//     absent. Still bounded, so a fast-fail that's never listed recovers too.
//   * miss-spacing (`now`/`minMissSpacingMs`): a miss counts only once
//     `minMissSpacingMs` has elapsed since the last, so a focus refresh firing
//     right after the 5s poll can't collapse the window. `now === 0` disables it.
//   * `preflight`: a send reserves the slot, then awaits attachment uploads
//     before the stream starts; that expected absence holds the tally clean.
//   * `producedData`: the turn's own SSE socket has delivered an event, proof it
//     started. Suppresses only the UNSEEN reap (the absence is registration lag,
//     not a never-started fast-fail); a seen-then-dropped turn is still a genuine
//     strand and reaps at `threshold`.
//
// Tally `{ cid, misses, seen, lastMissAt }` resets when the task reappears or the
// slot moves conversations.
export function reservationReleaseDecision(
  streamingTaskId,
  serverInFlightIds,
  prev,
  { threshold = 2, unseenThreshold = 4, preflight = false, producedData = false, now = 0, minMissSpacingMs = 4000 } = {},
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
    // disappearance is treated as the high-confidence strand.
    return { cid: streamingTaskId, misses: 0, seen: true, lastMissAt: 0, release: false };
  }

  // Absent and never registered, but the turn's own SSE socket has delivered
  // events — it provably started, so the absence is registration/replica lag,
  // not the fast-fail this path reaps. Defer to registration (→ seen) or the
  // stream's own terminal belt. Gated on !priorSeen: once listed, a later
  // disappearance is a genuine strand and reaps regardless of events.
  if (!priorSeen && producedData) {
    return { cid: streamingTaskId, misses: 0, seen: false, lastMissAt: 0, release: false };
  }

  // Absent. A seen turn releases fast; an unseen one gets the wider grace window.
  const limit = priorSeen ? threshold : unseenThreshold;

  // Miss-spacing guard: a poll within the spacing window doesn't count a fresh miss.
  if (now && priorMisses > 0 && now - priorLastMissAt < minMissSpacingMs) {
    return { cid: streamingTaskId, misses: priorMisses, seen: priorSeen, lastMissAt: priorLastMissAt, release: priorMisses >= limit };
  }

  const misses = priorMisses + 1;
  return { cid: streamingTaskId, misses, seen: priorSeen, lastMissAt: now, release: misses >= limit };
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
