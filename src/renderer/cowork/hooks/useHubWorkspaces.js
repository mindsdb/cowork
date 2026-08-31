import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubWorkspaces, setActiveHubWorkspace } from '../api';

// The MindsHub workspaces this person can use, and which one they are in.
//
// Read when the signed-in identity resolves rather than on every menu open: the
// sidecar caches the hub reads behind a short TTL, so a per-open fetch would
// mostly return the same answer, and the control is mounted for the whole
// session. `refresh` exists for a manual re-read.
//
// Everything about the failure shape is deliberate. `enabled` false is the
// resting state, so the sidebar renders exactly as it does today until something
// definitely says otherwise: while the read is in flight, when the person is
// signed out, when the sidecar is too old to have the route, and when the gate
// is off. There is no loading affordance for the same reason. A control that
// appeared, flickered, and vanished would be worse than one that appears a beat
// late.
//
// **A read that has not settled is retried, because one read per session made a
// blip permanent.** The renderer can mount before the sidecar is listening,
// which is ordinary on a cold start, and nothing else in the tree calls
// `refresh`. So a dropped connection or a 5xx used to hide the control until the
// app was relaunched. Two shapes count as unsettled, and the second is easy to
// miss: a thrown transport error, and a 200 saying the gate is on while the hub
// could not be reached, which is how the sidecar reports a failed hop to auth in
// band rather than as a status. A definite answer is not retried, because asking
// again cannot change it: a 404 from a sidecar with no such route, and a
// gate-off verdict, both arrive with `enabled` false.

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

  // Resolves true when the read settled on an answer, false when it did not and
  // is worth asking again. The effect below owns the retrying; this owns one
  // attempt, so `refresh` stays a plain one-shot re-read.
  //
  // Settling is decided on the answer, not on whether the call threw. A failed
  // hop to the hub arrives as a 200 that says `enabled` with `reachable` false,
  // because that is how the sidecar reports it, so keying off "did it throw"
  // would retry the localhost hop (which comes up in a second) and give up on
  // the remote one (which is the flaky half). Everything else is definite: a
  // gate-off or 404 answer carries `enabled` false and will not change by
  // asking again.
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
      // Bumped here as well as on entry, because unmount is the one way out of
      // this effect that changes no identity. Without it a `load()` still in
      // flight when the cleanup runs passes the generation check, arms a timer
      // the cleanup has already run past, and keeps asking for another forty
      // seconds after the control is gone.
      generation.current += 1;
      clearTimeout(timer);
    };
  }, [load]);

  // Rejects on failure; the caller owns the message. Nothing is applied
  // optimistically, because the server is the only thing that decides whether a
  // switch is allowed: showing the check on a row the server then refused is how
  // a client ends up disagreeing with the workspace its requests actually carry.
  //
  // Generation-guarded like the read, and for the same reason: a PUT started
  // under one account and resolving after the person changed would otherwise
  // write the previous account's workspaces into the new one's menu.
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
