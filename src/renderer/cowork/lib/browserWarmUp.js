/* Start the web browser early. It takes a while to boot, so the chat asks
   cowork-server to warm it (POST /browse/provision) before the agent needs
   it, only in a task that already used the browser: when the task opens, and
   when the person types in it. At most once per task every two minutes,
   fire-and-forget: a failure only means the agent waits a bit longer, so it
   is never surfaced. ChatView calls it only on the web (its `warmsBrowser`). */

export const WARM_UP_INTERVAL_MS = 2 * 60_000;

// `provision` is the call to make (api.provisionBrowser). Returns
// `warm(taskId)`, true when it fired and false when debounced.
export function createBrowserWarmUp(provision, { intervalMs = WARM_UP_INTERVAL_MS, now = () => Date.now() } = {}) {
  const lastWarmedAt = new Map();
  return function warm(taskId) {
    if (!taskId) return false;
    const at = now();
    const last = lastWarmedAt.get(taskId);
    if (last !== undefined && at - last < intervalMs) return false;
    // Forget tasks whose window has passed, so the map stays small.
    for (const [id, when] of lastWarmedAt) if (at - when >= intervalMs) lastWarmedAt.delete(id);
    lastWarmedAt.set(taskId, at);
    try {
      Promise.resolve(provision()).catch(() => {});
    } catch {
      // A synchronous throw is as ignorable as a rejected promise.
    }
    return true;
  };
}
