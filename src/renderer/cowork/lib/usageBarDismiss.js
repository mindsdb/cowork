import { useCallback, useEffect, useState } from 'react';

/* Closing the usage bar. A dismissal is per KEY, and the key is the descriptor's
   kind unless it narrows one: closing "620K free tokens left" keeps it closed
   while the tokens drain, and the bar comes back the moment the state changes
   to something else (free tokens used, balance low, ...).
   A balance running low is the case a bare kind gets wrong. "Low" is a band the
   balance sits in the whole way down, so one close would hide the only offer to
   top up until the balance emptied. Those warnings carry a stepped dismissKey
   instead (see balanceDismissStep in usageWarnings.js), so a close holds for the
   step it was made in and the next step down asks again.
   Once usage is healthy again, every closed WARNING is forgotten, so the next
   time a limit approaches the bar shows up as new. The standing figure is the
   healthy state itself (ENG-2749), so closing it is the one dismissal that
   survives that reset: someone who closed the number at 96% is not shown it
   again at 100% five hours later. It is forgotten only once the bar has
   nothing to show at all, which is what a top-up turns the figure into, so a
   wallet that empties again later gets the figure back. */

const KEY = 'anton.usageBar.dismissed';

function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function write(kinds) {
  try {
    if (kinds.length) window.localStorage.setItem(KEY, JSON.stringify(kinds));
    else window.localStorage.removeItem(KEY);
  } catch { /* storage unavailable: dismissals just don't persist */ }
}

/**
 * @param keys the dismissal keys of what the bar could show right now,
 *        outermost first: the warning, then what it steps down to when
 *        closed. Empty when there is nothing to show.
 * @param opts.resetWhenClear true only when usage is KNOWN and the bar is at
 *        rest (the standing figure, or nothing). "Not loaded yet" and
 *        "unreachable" also yield no keys, and neither may wipe a dismissal
 *        (that was how a closed bar came back on every launch).
 * @returns [dismissed keys, dismiss(key)]
 */
export function useUsageBarDismiss(keys, { resetWhenClear = false } = {}) {
  const [dismissed, setDismissed] = useState(read);
  // Joined so the effect keys on the VALUES; the caller builds a new array
  // every render.
  const live = keys.filter(Boolean).join('\n');

  // Healthy again: forget every dismissal except what is on screen now.
  useEffect(() => {
    if (!resetWhenClear) return;
    const keep = live ? live.split('\n') : [];
    const next = dismissed.filter((k) => keep.includes(k));
    if (next.length !== dismissed.length) {
      setDismissed(next);
      write(next);
    }
  }, [live, resetWhenClear, dismissed]);

  const dismiss = useCallback((key) => {
    if (!key) return;
    setDismissed((prev) => {
      const next = prev.includes(key) ? prev : [...prev, key];
      write(next);
      return next;
    });
  }, []);

  return [dismissed, dismiss];
}

export function resetUsageBarDismissForTests() {
  write([]);
}
