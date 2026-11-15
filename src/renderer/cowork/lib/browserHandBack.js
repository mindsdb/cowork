/* Done from outside the browser pane: the hand-over card's Done, continue does
   exactly what the browser's own Done does.

   On the desktop that is the in-app browser's handBack over IPC, which works
   whether the pane shows or not. On the web, Done lives in the browser
   router's viewer, framed in the pane. The viewer acts on a hand-back only
   once it knows the person holds the browser, which it learns from its own
   connection after it says it is ready, so the pane registers its frame here
   each time the viewer reports who holds the browser
   (registerHandBackViewer). While the person does, a hand-back posts it
   {type: 'browser-hand-back'}, which the viewer runs as its Done; while the
   agent does, there is nothing to hand back. With no such viewer for that
   browser yet (the pane is hidden, still opening, or its viewer hasn't said
   who holds it), the hand-back waits here and goes as soon as one registers,
   or ends there when the viewer says the agent holds the browser already;
   the caller opens the pane for it, and `handedBack` says when the browser
   is back. A pane that can't show that browser's viewer (no link, a viewer
   that stopped, a viewer that never came in time, or no pane for it at all)
   ends the wait (`dropHandBack`), and so does a pane that stops showing that
   browser (closed, or a task change), a hand-over card that goes or whose
   hand-over ends while it waits, the live turn's hand-over being answered
   another way, and the task starting a new turn (views/ChatView.jsx). A pane
   that already gave up when the hand-back is asked for tries again, so it
   gets a viewer or ends the wait. So nothing waits on a viewer that won't
   come, and a later hand-over never gets an old Done. */

import { host } from '../../platform/host';

export const HAND_BACK_MESSAGE = 'browser-hand-back';

/** sessionId -> the pane's viewer, as it last said who holds the browser:
    `send` posts it the hand-back, null while the agent holds it. */
const viewers = new Map();
/** Browsers whose hand-back waits for their viewer -> who waits on it. */
const pending = new Map();

/** @typedef {'sent' | 'unreachable'} HandBackEnd */

/**
 * @param {string} sessionId
 * @param {HandBackEnd} end
 */
function settle(sessionId, end) {
  const waiters = pending.get(sessionId);
  if (!waiters) return;
  pending.delete(sessionId);
  waiters.forEach((resolve) => resolve(end));
}

/**
 * Registers the pane's viewer for `sessionId` once it says who holds the
 * browser: `send` while the person does, null while the agent does. A
 * hand-back that waited for it goes at once, or, with the agent holding the
 * browser, ends with nothing to send; either way whoever waits on it hears
 * the browser is back. Returns the unregister.
 *
 * @param {string} sessionId
 * @param {(() => void) | null} send
 * @returns {() => void}
 */
export function registerHandBackViewer(sessionId, send) {
  if (!sessionId) return () => {};
  const viewer = { send };
  viewers.set(sessionId, viewer);
  if (pending.has(sessionId)) {
    send?.();
    settle(sessionId, 'sent');
  }
  return () => {
    if (viewers.get(sessionId) === viewer) viewers.delete(sessionId);
  };
}

/**
 * Hands the browser back as the browser's Done does.
 *
 * @param {string | null | undefined} sessionId
 * @param {{ desktop?: boolean, desktopHandBack?: (id: string) => Promise<unknown> }} [options]
 * @returns {Promise<'sent' | 'waiting' | 'none'>} `sent`: it went, or the web
 *   viewer says the agent holds the browser already. `waiting`: the web
 *   viewer isn't there yet, so the hand-back goes when it is (open the pane,
 *   and wait on `handedBack`).
 */
export async function handBackBrowser(sessionId, {
  desktop = host.supportsInAppBrowser,
  desktopHandBack = (id) => host.inAppBrowser.handBack(id),
} = {}) {
  if (!sessionId) return 'none';
  if (desktop) {
    await desktopHandBack(sessionId);
    return 'sent';
  }
  const viewer = viewers.get(sessionId);
  if (viewer) {
    // With the agent holding the browser, nothing waits: a later hand-over
    // must not get this Done.
    viewer.send?.();
    return 'sent';
  }
  if (!pending.has(sessionId)) pending.set(sessionId, new Set());
  return 'waiting';
}

/**
 * Ends the hand-back waiting for `sessionId`'s viewer when no viewer will
 * come for it: the pane couldn't get a link to that browser, its viewer
 * stopped (no browser free, the task cap, or it kept closing), a viewer that
 * never came in time (the pane's starting clock ran out), or no pane can show
 * that browser. A pane that already gave up tries again first, so it ends the
 * wait here or gets a viewer. A pane that stops showing that browser (closed,
 * or a task change) ends it too, and so does the hand-over card that waits on
 * it when the card goes or its hand-over ends, and the chat when the live
 * turn's hand-over is answered another way or the task starts a new turn.
 * Whoever waits on it hears `unreachable`, and a viewer that registers later
 * gets nothing: a later hand-over isn't handed back by this Done.
 *
 * @param {string | null | undefined} sessionId
 */
export function dropHandBack(sessionId) {
  if (sessionId) settle(sessionId, 'unreachable');
}

/**
 * Resolves once a hand-back that waits ends: `sent` when it went to the
 * viewer, or the viewer says the agent holds the browser already;
 * `unreachable` when no viewer will come for it (dropHandBack), so the
 * browser may still be the person's. `sent` at once when none waits for
 * `sessionId`, so a caller asks before anything that may drop it.
 *
 * @param {string | null | undefined} sessionId
 * @returns {Promise<HandBackEnd>}
 */
export function handedBack(sessionId) {
  const waiters = sessionId ? pending.get(sessionId) : null;
  if (!waiters) return Promise.resolve('sent');
  return new Promise((resolve) => { waiters.add(resolve); });
}

/** For tests: forget every viewer and waiting hand-back. */
export function resetHandBack() {
  viewers.clear();
  pending.clear();
}
