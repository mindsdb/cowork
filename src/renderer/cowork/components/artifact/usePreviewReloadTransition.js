// A smooth reload of the viewer's framed preview (ENG-4227). An applied quick
// edit, its Undo, and the preview check the edit asks for reload the preview;
// done bare, the page flashes blank and repaints. This covers it instead:
//
//   covering  an overlay in the page's background fades in (COVER_MS)
//   waiting   the reload runs behind it; the new document's load (the same
//             iframeReady signal the preview check waits on) plus SETTLE_MS
//   revealing the overlay fades out (REVEAL_MS)
//
// The wait is capped at MAX_WAIT_MS, so a page that never loads is revealed
// anyway rather than left dark. With prefers-reduced-motion, or when no
// framed preview is on screen, the reload runs at once with no overlay.
// One reload at a time: a reload asked for while one runs joins it.

import { useCallback, useEffect, useRef, useState } from 'react';

export const COVER_MS = 180;
export const SETTLE_MS = 300;
export const REVEAL_MS = 250;
export const MAX_WAIT_MS = 4000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled  A framed preview is on screen (its load is observable).
 * @param {boolean} opts.iframeReady  The frame's load state; a reload sets it false first.
 * @returns {{ phase: 'idle' | 'covering' | 'waiting' | 'revealing', reload: (trigger: () => void) => Promise<void> }}
 */
export function usePreviewReloadTransition({ enabled, iframeReady }) {
  const [phase, setPhase] = useState('idle');
  const waitersRef = useRef(new Set());
  const runningRef = useRef(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Set on mount, not only cleared on unmount: StrictMode mounts twice.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // A reload sets iframeReady false first, so the next true is the new
  // document's load (as in usePreviewCheckTarget).
  useEffect(() => {
    if (!iframeReady) return;
    const waiters = [...waitersRef.current];
    waitersRef.current.clear();
    waiters.forEach((resolve) => resolve());
  }, [iframeReady]);

  const set = (next) => { if (mountedRef.current) setPhase(next); };

  const reload = useCallback((trigger) => {
    if (!enabledRef.current || prefersReducedMotion()) {
      trigger();
      return Promise.resolve();
    }
    if (runningRef.current) return runningRef.current;
    const run = (async () => {
      try {
        set('covering');
        await sleep(COVER_MS);
        let onLoad;
        const loaded = new Promise((resolve) => { onLoad = resolve; waitersRef.current.add(resolve); });
        set('waiting');
        trigger();
        await Promise.race([loaded.then(() => sleep(SETTLE_MS)), sleep(MAX_WAIT_MS)]);
        waitersRef.current.delete(onLoad);
        set('revealing');
        await sleep(REVEAL_MS);
      } finally {
        set('idle');
        runningRef.current = null;
      }
    })();
    runningRef.current = run;
    return run;
  }, []);

  return { phase, reload };
}

export default usePreviewReloadTransition;
