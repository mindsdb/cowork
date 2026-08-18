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
