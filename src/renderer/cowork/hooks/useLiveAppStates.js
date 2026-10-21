import { useEffect, useState } from 'react';
import { fetchMyLiveApps } from '../api';

/*
 * Whether each of the person's live apps is running, for the cards' state
 * line. Asks only while live apps are on, so no other deployment sends the
 * request. Re-reads once a minute, since a slot stops an idle app on its own,
 * and whenever `refreshKey` changes. The chat rail passes its streaming flag,
 * so a turn's start and its end both re-read; the end is when the agent has
 * launched or relaunched an app. The Live Artifacts page passes its artifact
 * list, which App reloads when a turn ends.
 *
 * A failed read keeps the last answer: the line is a hint, and the app's old
 * address explains a stop by itself. Two failures stop the minute's polling
 * until the next refresh, since asking again can't change them: a 404 means
 * the server runs no live apps any more, so the lines go too, and a 401 waits
 * for the person to sign in again.
 */

const REFRESH_MS = 60_000;
const NONE = new Map();

export function useLiveAppStates(liveApps, refreshKey = null) {
  const [states, setStates] = useState(NONE);
  useEffect(() => {
    if (!liveApps) {
      setStates(NONE);
      return undefined;
    }
    let cancelled = false;
    const load = () => {
      fetchMyLiveApps()
        .then((next) => { if (!cancelled) setStates(next); })
        .catch((e) => {
          if (cancelled) return;
          if (e?.status === 404) setStates(NONE);
          if (e?.status === 404 || e?.status === 401) clearInterval(timer);
        });
    };
    const timer = setInterval(load, REFRESH_MS);
    load();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [liveApps, refreshKey]);
  return states;
}
