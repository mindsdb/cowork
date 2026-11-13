/* Done from outside the browser pane: the hand-over card's Done, continue does
   exactly what the browser's own Done does.

   On the desktop that is the in-app browser's handBack over IPC, which works
   whether the pane shows or not. On the web, Done lives in the browser
   router's viewer, framed in the pane: the pane registers its frame here once
   the viewer says it is ready (registerHandBackViewer), and a hand-back posts
   it {type: 'browser-hand-back'}, which the viewer runs as its Done. With no
   viewer for that browser yet (the pane is hidden or still opening), the
   hand-back waits here and goes as soon as one registers; the caller opens
   the pane for it. */

import { host } from '../../platform/host';

export const HAND_BACK_MESSAGE = 'browser-hand-back';

/** sessionId -> sends the viewer the hand-back. */
const viewers = new Map();
/** Browsers whose hand-back waits for their viewer. */
const pending = new Set();

/**
 * Registers the pane's viewer for `sessionId`; a hand-back that waited for
 * it goes at once. Returns the unregister.
 *
 * @param {string} sessionId
 * @param {() => void} send
 * @returns {() => void}
 */
export function registerHandBackViewer(sessionId, send) {
  if (!sessionId) return () => {};
  viewers.set(sessionId, send);
  if (pending.delete(sessionId)) send();
  return () => {
    if (viewers.get(sessionId) === send) viewers.delete(sessionId);
  };
}

/**
 * Hands the browser back as the browser's Done does.
 *
 * @param {string | null | undefined} sessionId
 * @param {{ desktop?: boolean, desktopHandBack?: (id: string) => Promise<unknown> }} [options]
 * @returns {Promise<'sent' | 'waiting' | 'none'>} `waiting`: the web viewer
 *   isn't there yet, so the hand-back goes when it is (open the pane).
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
  const send = viewers.get(sessionId);
  if (send) {
    send();
    return 'sent';
  }
  pending.add(sessionId);
  return 'waiting';
}

/** For tests: forget every viewer and waiting hand-back. */
export function resetHandBack() {
  viewers.clear();
  pending.clear();
}
