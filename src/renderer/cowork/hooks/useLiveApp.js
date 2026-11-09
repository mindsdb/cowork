import { useEffect, useState } from 'react';
import { fetchMyLiveApps } from '../api';
import { liveAppKey } from '../lib/liveAppState';

const OFF = { status: 'off' };

/** Read the current launch while its viewer is open; never expose another artifact's cached state. */
export function useLiveApp(artifact, { enabled, refreshKey = null }) {
  const [read, setRead] = useState(OFF);
  const key = liveAppKey(artifact?.projectId, artifact?.slug);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer;
    const refresh = async () => {
      try {
        const states = await fetchMyLiveApps();
        if (!cancelled) setRead({ key, status: 'ready', state: states.get(key) });
      } catch (error) {
        if (!cancelled) setRead(previous => previous.key === key && previous.status === 'ready'
          && error.status !== 401 && error.status !== 403 ? previous : { key, status: 'failed' });
      } finally {
        if (!cancelled) timer = setTimeout(refresh, 15000);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, key, refreshKey]);
  return !enabled ? OFF : read.key === key ? read : { status: 'loading' };
}
