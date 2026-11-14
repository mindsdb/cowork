// A turn whose connection dropped, as opposed to one the agent failed. The
// server keeps running the turn when the reader goes away, so the error card
// for a drop stands only until the app reaches the turn again: it reattaches
// to a turn that is still running, or loads the answer of one that finished.

// Codes the stream readers in api.js give a lost connection.
const DROPPED_STREAM_CODES = new Set(['stream_error', 'reconnect_error', 'interrupted', 'stalled']);

// How long to wait before each try to reach the turn again, about five
// minutes in all. Coming back online tries at once.
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 60000, 60000, 60000];

/** True when the stream broke on the way, not when the server refused or failed the turn. */
export function isDroppedStream(event) {
  return DROPPED_STREAM_CODES.has(event?.code)
    && event?.type !== 'response.failed'
    && typeof event?.http_status !== 'number';
}

/**
 * The rows the drop that left `error` left behind (its turn's partial answer
 * and the error), gone once that turn is reached again. Another turn's drop
 * keeps its rows. They share the error's `_userMessageId`; without one, they
 * are the drop's rows after that turn's user message.
 */
export function withoutDroppedRows(messages, error) {
  const at = messages.indexOf(error);
  if (at < 0) return messages;
  const turnStart = messages.findLastIndex((m, i) => i < at && m.role === 'user');
  const ofTurn = (m, i) => (error._userMessageId
    ? m._userMessageId === error._userMessageId
    : i > turnStart && i <= at);
  return messages.filter((m, i) => !(m._dropped && (m === error || ofTurn(m, i))));
}

/** The latest error a drop left on this task, if it is still on screen. */
export function droppedError(task) {
  return task?.messages?.findLast((m) => m._dropped && m.role === 'error') ?? null;
}

/** Stop showing that the app is trying to reconnect, keeping the error. */
export function stopReconnecting(messages) {
  return messages.map((m) => (m._dropped && m.role === 'error' && m._reconnecting ? { ...m, _reconnecting: false } : m));
}

/**
 * Whether a history page holds the end of the turn whose user message is
 * `userMessageId`: its answer, or the failure the server saved for it.
 */
export function historyEndsTurn(history, userMessageId) {
  if (!userMessageId || !Array.isArray(history)) return false;
  const lastUser = history.findLastIndex((m) => m.role === 'user');
  if (lastUser < 0 || history[lastUser].id !== userMessageId) return false;
  return history.slice(lastUser + 1).some((m) => (
    m.role === 'error' || m.role === 'provider_required' || (m.role === 'assistant' && m._turnComplete)
  ));
}

/** Waits `ms`, or less if the browser comes back online meanwhile. */
export function waitOrOnline(ms) {
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    if (typeof window !== 'undefined') window.addEventListener('online', done);
  });
}
