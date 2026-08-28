import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubUsage } from '../api';

// The signed-in account's usage: free monthly tokens, paid balance, auto top up.
//
// Same shape and the same failure philosophy as useHubWorkspaces: `reachable`
// false is the resting state, so every surface renders exactly as it did before
// this existed until the sidecar definitely says otherwise. Polled while signed
// in so a warning appears (and clears after a top up) without a restart; the
// sidecar caches the read for 30s, so a poll costs it nothing most of the time.

export const HUB_USAGE_POLL_MS = 30_000;

const DARK = Object.freeze({ reachable: false });

export function useHubUsage(accountUser, { pollMs = HUB_USAGE_POLL_MS } = {}) {
  const [usage, setUsage] = useState(DARK);
  const generation = useRef(0);
  const sub = accountUser?.sub ?? null;

  const refresh = useCallback(async () => {
    const mine = generation.current;
    if (!sub) {
      setUsage(DARK);
      return;
    }
    const payload = await fetchHubUsage();
    if (generation.current !== mine) return;
    // Keep the last good read through a blip, so a warning doesn't flicker
    // off and on when one poll fails.
    setUsage((prev) => (payload?.reachable ? payload : prev?.reachable ? prev : DARK));
  }, [sub]);

  useEffect(() => {
    generation.current += 1;
    refresh();
    if (!sub) return undefined;
    // Coming back from the console after a top up should clear the bar at
    // once, not on the next tick.
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    const timer = pollMs ? setInterval(refresh, pollMs) : null;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (timer) clearInterval(timer);
    };
  }, [refresh, sub, pollMs]);

  return { usage, refresh };
}
