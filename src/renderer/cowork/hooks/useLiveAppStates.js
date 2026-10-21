import { useEffect, useState } from 'react';
import { fetchMyLiveApps } from '../api';

// Whether each of the person's live apps is running, for the cards' state
// line. Asks only while live apps are on, so no other deployment sends the
// request. Refreshes once a minute, since a slot stops an idle app on its own,
// and whenever `refreshKey` changes (the rail passes the end of a turn, which
// is when the agent launches or relaunches an app).
//
// A failed read keeps the last answer: the line is a hint, and the app's old
// address explains a stop by itself.

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
        .catch(() => { /* keep the last answer */ });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [liveApps, refreshKey]);
  return states;
}
