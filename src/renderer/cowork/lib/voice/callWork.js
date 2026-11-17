// The work a voice call handed Anton and still waits on (ENG-4138, prototype).
//
// - `createCallWork()` is the call's list, oldest first. Each entry gets its
//   own `done`, which resolves once it is settled (answered, dropped, given up
//   on or cleared), so whatever waits on it never waits forever.
// - `createQueueWatch()` follows queued messages by their queue item id: the
//   drain says when one runs, and a sweep of the queues finds one removed
//   before it ran (Stop drops what was queued, or the person removed it).
// - `sendForOwnTurn()` sends a request into a task and resolves with the end
//   of the turn that runs that request, not just the next turn there: a send
//   that queues behind other work waits for its own queue item's turn.
// - `askInTask()` is the same for ask_anton in a task that exists: its
//   `finished` resolves with the answer of the request's own turn.

import { waitForTurnEnd } from './turnEnds';

// The longest a queued request is waited on: past this the call stops waiting
// (and stops counting it as running), though the message still runs.
export const OWN_TURN_WAIT_MS = 30 * 60_000;

export function createCallWork() {
  const works = new Map();
  const add = (work) => {
    const key = Symbol('call work');
    let resolveDone;
    const entry = Object.assign(work, {
      done: new Promise((resolve) => { resolveDone = resolve; }),
      // Takes it off the list; true when it was still on it (not cleared).
      settle: () => {
        if (!works.delete(key)) return false;
        resolveDone();
        return true;
      },
    });
    works.set(key, entry);
    return entry;
  };
  return {
    add,
    busy: () => works.size > 0,
    first: () => works.values().next().value || null,
    last: () => [...works.values()].at(-1) || null,
    inTask: (taskId) => [...works.values()].filter((w) => w.taskId === taskId),
    clear: () => { [...works.values()].forEach((w) => w.settle()); },
  };
}

export function createQueueWatch() {
  const watched = new Map();
  return {
    // `handlers`: {run(taskId), drop()}. Returns a function that stops watching.
    watch(itemId, handlers) {
      watched.set(itemId, handlers);
      return () => { if (watched.get(itemId) === handlers) watched.delete(itemId); };
    },
    // The drain took `itemId` off the queue of `taskId` to run it.
    ran(itemId, taskId) {
      const handlers = watched.get(itemId);
      if (!handlers) return;
      watched.delete(itemId);
      handlers.run(taskId);
    },
    // `queues` ({taskId: [item]}) as they are now: a watched item in none of
    // them left without running.
    sweep(queues) {
      if (!watched.size) return;
      const present = new Set(Object.values(queues || {}).flat().map((item) => item?.id));
      for (const [itemId, handlers] of [...watched]) {
        if (present.has(itemId)) continue;
        watched.delete(itemId);
        handlers.drop();
      }
    },
  };
}

/**
 * `send(onQueued)` sends the request into `taskId` (handleSendInTask), calling
 * `onQueued(itemId)` if it queued it, and resolves false when it couldn't take
 * it. Resolves with `{sent, turn}`, where `turn` resolves with
 * `{content, error}` at the end of the request's own turn, an error when its
 * queue item was removed first, or `{timedOut: true}` after `timeoutMs`.
 */
export async function sendForOwnTurn({ taskId, send, queueWatch, timeoutMs = OWN_TURN_WAIT_MS }) {
  let settle;
  const ended = new Promise((resolve) => { settle = resolve; });
  let waiting = null;
  const follow = (id) => {
    waiting = waitForTurnEnd(id);
    waiting.promise.then(({ content, error }) => settle({ content, error: error ? String(error) : '' }));
  };
  // Sent at once, it runs in the next turn there; the waiter is set first, so
  // a short turn can't end before it.
  follow(taskId);
  let unwatch = null;
  const onQueued = (itemId) => {
    waiting.cancel();
    unwatch = queueWatch.watch(itemId, {
      run: (runTaskId) => follow(runTaskId || taskId),
      drop: () => settle({ content: '', error: 'it was taken off the queue before it ran' }),
    });
  };
  const timer = setTimeout(() => settle({ timedOut: true }), timeoutMs);
  const turn = ended.then((outcome) => {
    clearTimeout(timer);
    waiting?.cancel();
    unwatch?.();
    return outcome;
  });
  let sent;
  try {
    sent = await send(onQueued);
  } catch (err) {
    settle({ content: '', error: 'not sent' });
    throw err;
  }
  if (sent === false) settle({ content: '', error: 'not sent' });
  return { sent: sent !== false, turn };
}

/**
 * ask_anton's send into an existing task (sendForOwnTurn's arguments): in a
 * task whose turn is running, the request queues and `finished` waits for the
 * turn that runs it, not the running one. Resolves with `{sent, finished}`,
 * where `finished` resolves with the answer, or rejects with the turn's error
 * (`timedOut: true` on the error when the wait gave up).
 */
export async function askInTask(args) {
  const { sent, turn } = await sendForOwnTurn(args);
  const finished = turn.then(({ content, error, timedOut }) => {
    if (timedOut) throw Object.assign(new Error('no answer in time'), { timedOut: true });
    if (error) throw new Error(String(error));
    return content;
  });
  return { sent, finished };
}
