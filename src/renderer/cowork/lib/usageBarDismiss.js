import { useCallback, useEffect, useState } from 'react';

// Closing the usage bar (ENG-1782). A dismissal is per warning KIND, so closing
// "620K free tokens left" keeps it closed while the tokens drain, and the bar
// comes back the moment the state changes to something else (free tokens used,
// balance low, ...). Everything is forgotten once usage is healthy again, so
// the next time a limit approaches the bar shows up as new.

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
 * @param kind the current warning's kind, or null when there is nothing to show
 * @returns [dismissed, dismiss]
 */
export function useUsageBarDismiss(kind) {
  const [dismissed, setDismissed] = useState(read);

  // Healthy again: forget every dismissal.
  useEffect(() => {
    if (kind === null && dismissed.length) {
      setDismissed([]);
      write([]);
    }
  }, [kind, dismissed.length]);

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
