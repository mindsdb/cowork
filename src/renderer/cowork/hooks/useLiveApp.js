import { useEffect, useState } from 'react';
import { fetchMyLiveApps } from '../api';
import { liveAppKey } from '../lib/liveAppState';

/*
 * Whether one of the person's live apps is running, and where, for its
 * viewer. Read when the viewer opens and again on each `refreshKey`, which
 * the viewer bumps on Reload. Unlike the cards' hook, a failed read is its
 * own answer: the viewer must not say an app isn't running when it couldn't
 * ask.
 */

const OFF = { status: 'off' };

/**
 * @param {{ projectId?: string, slug?: string } | null} artifact
 * @param {{ enabled: boolean, refreshKey?: unknown }} options
 * @returns {{ status: 'off' | 'loading' | 'ready' | 'failed', state?: import('../lib/liveAppState').LiveAppState }}
 */
export function useLiveApp(artifact, { enabled, refreshKey = null }) {
  const [read, setRead] = useState(OFF);
  const key = liveAppKey(artifact?.projectId, artifact?.slug);
  useEffect(() => {
    if (!enabled) {
      setRead(OFF);
      return undefined;
    }
    let cancelled = false;
    setRead({ status: 'loading' });
    fetchMyLiveApps()
      .then((states) => { if (!cancelled) setRead({ status: 'ready', state: states.get(key) }); })
      .catch(() => { if (!cancelled) setRead({ status: 'failed' }); });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, refreshKey]);
  return read;
}
