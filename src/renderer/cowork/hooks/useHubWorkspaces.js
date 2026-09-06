import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubWorkspaces, setActiveHubWorkspace } from '../api';

// Read workspaces when identity resolves; keep the control absent until an enabled, reachable
// answer arrives.
// Retry unsettled startup reads (transport failures or enabled+unreachable); gate-off and legacy
// 404 answers are definitive.
// refresh is a one-shot manual read.

const DARK = Object.freeze({
  enabled: false,
  reachable: false,
  workspaces: [],
  activeWorkspaceId: null,
});

// Three tries after the first, then stop. Bounded on purpose: past half a minute
// the sidecar is not coming up on its own, and a control that appears after a
// user has stopped looking at the rail is not worth a background poll.
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

/** One shape whatever the server said, so nothing downstream guards a field. */
function normalize(payload) {
  return {
    enabled: payload?.enabled === true,
    reachable: payload?.reachable === true,
    workspaces: Array.isArray(payload?.workspaces) ? payload.workspaces : [],
    activeWorkspaceId: payload?.activeWorkspaceId ?? null,
  };
}

export function useHubWorkspaces(accountUser) {
  const [state, setState] = useState(DARK);
  const [switching, setSwitching] = useState(false);
  // Bumped on every identity change. A read that resolves after the identity
  // moved on compares its own generation and drops itself, which is what stops
  // the previous account's workspaces landing in the new account's menu.
  const generation = useRef(0);

  // Keyed on the account's subject rather than the object: `useAccountUser`
  // builds a fresh object on every resolve, so depending on it directly would
  // re-fetch on any re-render that re-decoded the same token.
  const sub = accountUser?.sub ?? null;

  // A 200 with enabled=true/reachable=false is unsettled too; retrying only exceptions misses
  // failed auth hops.
  // Gate-off/legacy 404 answers have enabled=false and need no retry.
  const settled = (next) => !(next.enabled && !next.reachable);

  const load = useCallback(async () => {
    const mine = generation.current;
    if (!sub) {
      setState(DARK);
      return true;
    }
    try {
      const next = normalize(await fetchHubWorkspaces());
      if (generation.current === mine) setState(next);
      return settled(next);
    } catch {
      if (generation.current === mine) setState(DARK);
      return false;
    }
  }, [sub]);

  useEffect(() => {
    generation.current += 1;
    // An in-flight switch belongs to the identity that started it. Leaving the
    // flag set would hand the next account a menu with every row disabled until
    // that switch settled.
    setSwitching(false);
    const mine = generation.current;
    let timer;
    const attempt = async (n) => {
      if (await load()) return;
      if (generation.current !== mine) return;
      const delay = RETRY_DELAYS_MS[n];
      if (delay === undefined) return;
      timer = setTimeout(() => attempt(n + 1), delay);
    };
    attempt(0);
    return () => {
      // Invalidate in-flight loads on unmount too, or a late response can arm retries after
      // cleanup.
      generation.current += 1;
      clearTimeout(timer);
    };
  }, [load]);

  // Apply only server-confirmed workspace switches; reject failures for the caller to display.
  // Discard responses from a previous identity so its workspaces cannot populate the new account's
  // menu.
  const switchWorkspace = useCallback(async (workspaceId) => {
    const mine = generation.current;
    setSwitching(true);
    try {
      const payload = await setActiveHubWorkspace(workspaceId);
      if (generation.current === mine) setState(normalize(payload));
    } finally {
      if (generation.current === mine) setSwitching(false);
    }
  }, []);

  return { ...state, switching, switchWorkspace, refresh: load };
}
