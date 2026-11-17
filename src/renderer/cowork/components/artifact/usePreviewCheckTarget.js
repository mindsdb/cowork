// The artifact viewer's side of a preview check (ENG-4207, lib/artifactCheck).
// While the viewer shows a preview, it registers under the artifact's slug.
// A check reloads the preview the same way the reload button does, waits for
// the frame's load event plus a settle period, and reports every diagnostic
// the reloaded page sent in that time.

import { useEffect, useRef } from 'react';
import { registerPreviewCheckTarget, SETTLE_MS } from '../../lib/artifactCheck';

// The server keeps at most this many (usePreviewDiagnostics caps the same).
const MAX_ERRORS = 20;

const keyOf = (e) => `${e.message}|${e.file}|${e.line}`;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

/**
 * @param {object} opts
 * @param {string} opts.slug  The artifact's slug, as the server names it in the check.
 * @param {boolean} opts.enabled  A preview frame this check can reload is on screen.
 * @param {() => void} opts.reload  The viewer's own reload (bumps its nonce).
 * @param {boolean} opts.iframeReady  The preview frame's load state.
 * @param {import('./usePreviewDiagnostics').PreviewDiagnostic[]} opts.errors
 * @param {number} [opts.settleMs]
 */
export function usePreviewCheckTarget({ slug, enabled, reload, iframeReady, errors, settleMs = SETTLE_MS }) {
  const reloadRef = useRef(reload);
  const errorsRef = useRef(errors);
  const loadWaitersRef = useRef(new Set());
  // While a check runs: the errors array it started from and what it saw.
  const collectingRef = useRef(null);

  useEffect(() => { reloadRef.current = reload; }, [reload]);

  // A reload sets iframeReady false first, so the next true is the reloaded
  // document's load, not the one the check started from.
  useEffect(() => {
    if (!iframeReady) return;
    const waiters = [...loadWaitersRef.current];
    loadWaitersRef.current.clear();
    waiters.forEach((resolve) => resolve());
  }, [iframeReady]);

  // Every errors array after the one the check started with comes from the
  // reloaded document (a reload clears the list before its first report).
  // Collected rather than read once at the end: a page that restarts itself
  // clears the list again, and its first failure still counts.
  useEffect(() => {
    errorsRef.current = errors;
    const collecting = collectingRef.current;
    if (!collecting || errors === collecting.baseline) return;
    for (const error of errors) {
      if (collecting.list.length >= MAX_ERRORS) break;
      const key = keyOf(error);
      if (collecting.keys.has(key)) continue;
      collecting.keys.add(key);
      collecting.list.push({ ...error });
    }
  }, [errors]);

  useEffect(() => {
    if (!enabled || !slug) return undefined;
    const run = async ({ deadlineMs }) => {
      const collecting = { baseline: errorsRef.current, keys: new Set(), list: [] };
      collectingRef.current = collecting;
      let onLoad;
      const loaded = new Promise((resolve) => {
        onLoad = resolve;
        loadWaitersRef.current.add(resolve);
      });
      try {
        reloadRef.current();
        const loadBudget = deadlineMs - Date.now() - settleMs;
        const didLoad = await Promise.race([
          loaded.then(() => true),
          sleep(loadBudget).then(() => false),
        ]);
        // A preview that never finished loading says nothing either way.
        if (!didLoad) return { status: 'unavailable' };
        await sleep(settleMs);
        return collecting.list.length
          ? { status: 'failed', errors: collecting.list }
          : { status: 'passed' };
      } finally {
        loadWaitersRef.current.delete(onLoad);
        if (collectingRef.current === collecting) collectingRef.current = null;
      }
    };
    return registerPreviewCheckTarget(slug, { run });
  }, [enabled, slug, settleMs]);
}

export default usePreviewCheckTarget;
