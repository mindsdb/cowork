// When an Anton turn ends, for a voice call waiting on its answer (prototype).
//
// The app's send paths start a turn and return; its answer arrives in the
// stream's onDone or onError. Those report here, by every id the task had
// during the turn (a new task is renamed to the server's id), and a call that
// sent the turn waits for the report that names its task.

const waiters = new Set();

/**
 * Resolves with `{ content, error, finalId }` at the next end of a turn of
 * `taskId`. `cancel()` stops waiting.
 */
export function waitForTurnEnd(taskId) {
  let waiter;
  const promise = new Promise((resolve) => {
    waiter = { taskId, resolve };
    waiters.add(waiter);
  });
  return { promise, cancel: () => waiters.delete(waiter) };
}

/** Called by the send paths' onDone and onError with each id the task had. */
export function reportTurnEnd(ids, { content = '', error = null, finalId = null } = {}) {
  const named = new Set((ids || []).filter(Boolean));
  for (const waiter of [...waiters]) {
    if (!named.has(waiter.taskId)) continue;
    waiters.delete(waiter);
    waiter.resolve({ content, error, finalId: finalId || waiter.taskId });
  }
}
