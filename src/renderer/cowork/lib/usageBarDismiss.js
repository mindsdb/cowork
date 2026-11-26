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
 * @param opts.resetWhenClear true only when usage is KNOWN and the bar is at
 *        rest: nothing to warn about, for every pick. "Not loaded
 *        yet" and "unreachable" must not count (that was how a closed bar came
 *        back on every launch), and neither may a warning the person merely
 *        closed, or "healthy" would just mean "closed".
 * @returns [dismissed keys, dismiss(key)]
 */
export function useUsageBarDismiss({ resetWhenClear = false } = {}) {
  const [dismissed, setDismissed] = useState(read);

  // Healthy again: forget every dismissal.
  useEffect(() => {
    if (resetWhenClear && dismissed.length) {
      setDismissed([]);
      write([]);
    }
  }, [resetWhenClear, dismissed.length]);

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
