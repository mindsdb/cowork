import { useEffect, useState } from 'react';
import { onInAppBrowserRegistered } from '../../platform/host';
import { readBrowseStatus } from '../lib/browseStatus';

/* After a read fails, the hook asks again after these delays, one per
   failure in a row, and then at the last one for as long as reads fail. A
   stalled read fails at the reader's time limit and takes this backoff too,
   rather than hold off every later ask. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];

/**
 * Whether this deployment offers the shared browser to this person now, as
 * GET /browse/status last answered `available`.
 *
 * It reads the status as Settings does (lib/browseStatus.js). False until
 * the first read settles, after an answered `available: false`, and on a
 * server with no such route (a 404), which predates the browser. A read that
 * fails another way changes no answer the hook already holds.
 * Before any answer, a failed read gives true: turns may still get the
 * browser, so the + menu keeps its switch while Settings has the browser on,
 * and that switch can only take the browser away.
 *
 * It asks again whenever `askAgain` changes (the server coming up, an
 * organization switch, the desktop UI saying it shows the in-app browser),
 * when main says the local server took the in-app browser's registration,
 * when the window gets focus or the tab is visible again, and after a failed
 * read on the backoff above. A read with no answer in the reader's
 * READ_TIMEOUT_MS has failed. Only the newest ask's answer counts.
 *
 * @param {unknown} askAgain
 * @returns {boolean}
 */
export function useBrowseAvailable(askAgain) {
  // The last answer, or null while no read has answered.
  const [answer, setAnswer] = useState(/** @type {boolean | null} */ (null));
  // Whether the newest settled read failed.
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let asks = 0;
    let asking = false;
    let failures = 0;
    let retry;
    const settle = (available) => {
      asking = false;
      failures = 0;
      setAnswer(available);
      setReadFailed(false);
    };
    const ask = () => {
      clearTimeout(retry);
      asks += 1;
      const mine = asks;
      asking = true;
      readBrowseStatus().then(
        (status) => {
          if (live && mine === asks) settle(status?.available === true);
        },
        () => {
          if (!live || mine !== asks) return;
          asking = false;
          setReadFailed(true);
          retry = setTimeout(ask, RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]);
          failures += 1;
        },
      );
    };
    /* Focus and a visible tab often come together, and a read already in
       flight answers for both. */
    const onFocus = () => {
      if (!asking) ask();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    ask();
    const stopRegistered = onInAppBrowserRegistered(ask);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      clearTimeout(retry);
      stopRegistered();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [askAgain]);

  return answer ?? readFailed;
}
