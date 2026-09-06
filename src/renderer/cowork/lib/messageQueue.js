// Anton's single stream slot serializes sends, but queues belong to tasks.
// After a turn ends, consider every existing task’s queue so navigation cannot strand messages;
// prefer the finishing task.
export function selectNextQueuedTask(queues, existingTaskIds, preferredTaskId) {
  const exists = existingTaskIds instanceof Set
    ? (id) => existingTaskIds.has(id)
    : (id) => Array.isArray(existingTaskIds) && existingTaskIds.includes(id);
  const hasQueue = (id) =>
    Array.isArray(queues?.[id]) && queues[id].length > 0 && exists(id);

  if (preferredTaskId && hasQueue(preferredTaskId)) return preferredTaskId;
  return Object.keys(queues || {}).find(hasQueue) || null;
}

// Recover a stream slot whose terminal event never arrived, using the server’s running list.
// Use spaced misses, with a longer threshold for never-seen turns because registration can lag.
// Preflight uploads reset misses; SSE data suppresses only never-seen reaping, not
// seen-then-dropped recovery.
// Reset the tally when the task reappears or the slot changes; now=0 disables miss-spacing.
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

  // SSE data proves a never-seen turn started despite registration lag.
  // Once seen, a later disappearance still counts toward reaping.
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

// Drop a cid we're still tailing ourselves — its own onDone/onError is the
// real terminal signal, so a poll miss there is lag, not a finish.
export function finishedCids(prevIds, nextIds, streamingTaskId) {
  const next = new Set(nextIds);
  return [...prevIds].filter((cid) => !next.has(cid) && cid !== streamingTaskId);
}

// Move temporary-id queues to the canonical id: existing destination items first, then sources in
// order.
// Return the original map when nothing moves so React can skip the update.
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
