import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubWorkspaces, setActiveHubWorkspace } from '../api';

// The MindsHub workspaces this person can use, and which one they are in.
//
// Read once when the signed-in identity resolves rather than on every menu open:
// the sidecar caches the hub reads behind a short TTL, so a per-open fetch would
// mostly return the same answer, and the account menu is mounted for the whole
// session. `refresh` exists for after a switch.
//
// Everything about the failure shape is deliberate. `enabled` false is the
// resting state, so the menu renders exactly as it does today until something
// definitely says otherwise: while the read is in flight, when the person is
// signed out, when the sidecar is too old to have the route, and when the gate
// is off. There is no loading affordance for the same reason. A group that
// appeared, flickered, and vanished would be worse than one that appears a beat
// late.

const DARK = Object.freeze({
  enabled: false,
  reachable: false,
  workspaces: [],
  activeWorkspaceId: null,
});

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

  const load = useCallback(async () => {
    const mine = generation.current;
    if (!sub) {
      setState(DARK);
      return;
    }
    const payload = await fetchHubWorkspaces();
    if (generation.current === mine) setState(normalize(payload));
  }, [sub]);

  useEffect(() => {
    generation.current += 1;
    load();
  }, [load]);

  // Rejects on failure; the caller owns the message. Nothing is applied
  // optimistically, because the server is the only thing that decides whether a
  // switch is allowed: showing the check on a row the server then refused is how
  // a client ends up disagreeing with the workspace its requests actually carry.
  const switchWorkspace = useCallback(async (workspaceId) => {
    setSwitching(true);
    try {
      setState(normalize(await setActiveHubWorkspace(workspaceId)));
    } finally {
      setSwitching(false);
    }
  }, []);

  return { ...state, switching, switchWorkspace, refresh: load };
}
