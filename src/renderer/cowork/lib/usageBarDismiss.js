import { useCallback, useEffect, useState } from 'react';

/* Closing the usage bar. A dismissal is per KEY, and the key is the warning's
   kind unless the warning narrows it: closing "620K free tokens left" keeps it
   closed while the tokens drain, and the bar comes back the moment the state
   changes to something else (free tokens used, balance low, ...).
   A balance running low is the case a bare kind gets wrong. "Low" is a band the
   balance sits in the whole way down, so one close would hide the only offer to
   top up until the balance emptied. Those warnings carry a stepped dismissKey
   instead (see balanceDismissStep in usageWarnings.js), so a close holds for the
   step it was made in and the next step down asks again.
   Everything is forgotten once usage is healthy again, so the next time a limit
   approaches the bar shows up as new. */

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
 * @param kind the current warning's dismissal key, or null when there is nothing to show
 * @param opts.resetWhenClear true only when usage is KNOWN and has nothing to
 *        warn about. "Not loaded yet" and "unreachable" also yield a null kind,
 *        and neither may wipe a dismissal (that was how a closed bar came back
 *        on every launch).
 * @returns [dismissed, dismiss]
 */
export function useUsageBarDismiss(kind, { resetWhenClear = false } = {}) {
  const [dismissed, setDismissed] = useState(read);

  // Healthy again: forget every dismissal.
  useEffect(() => {
    if (kind === null && resetWhenClear && dismissed.length) {
      setDismissed([]);
      write([]);
    }
  }, [kind, resetWhenClear, dismissed.length]);

  const dismiss = useCallback(() => {
    if (!kind) return;
    setDismissed((prev) => {
      const next = prev.includes(kind) ? prev : [...prev, kind];
      write(next);
      return next;
    });
  }, [kind]);

  return [!!kind && dismissed.includes(kind), dismiss];
}

export function resetUsageBarDismissForTests() {
  write([]);
}
