// Keep a datasource list moving while a connection is still being checked.
//
// A cloud database connection is stored before it is known to work: the server
// holds the credential encrypted, a probe dials the database, and only then
// does the row read verified or failed. A list fetched at the moment of
// capture can therefore be stale the instant it arrives, and the composer
// offers only verified connections, so a row left at `pending` is a database
// the user set up and cannot use until they reload the page.
//
// Bounded on purpose. The check is quick, so a row that is still pending after
// the attempts below means validation did not run at all, and no amount of
// further polling changes that.

import { useEffect, useRef } from 'react';

export const PENDING_POLL_INTERVAL_MS = 3000;
export const PENDING_POLL_ATTEMPTS = 10;

function hasPending(rows) {
  return Array.isArray(rows) && rows.some((row) => row && row.status === 'pending');
}

/**
 * Re-run `refresh` while any row in `rows` is pending.
 *
 * @param {Array} rows datasource rows, as `toDatasourceRows` returns them
 * @param {Function} refresh fetches the list again; called with no arguments
 * @param {boolean} enabled false switches the poll off entirely (desktop)
 */
export function usePendingDatasourceRefresh(rows, refresh, enabled = true) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // The budget refills whenever nothing is pending, so the next capture polls
  // as freely as the first one did.
  const attemptsLeft = useRef(PENDING_POLL_ATTEMPTS);

  useEffect(() => {
    if (!enabled || !hasPending(rows)) {
      attemptsLeft.current = PENDING_POLL_ATTEMPTS;
      return undefined;
    }
    if (attemptsLeft.current <= 0) return undefined;
    const timer = setTimeout(() => {
      attemptsLeft.current -= 1;
      refreshRef.current?.();
    }, PENDING_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [enabled, rows]);
}
