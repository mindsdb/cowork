import { useState, useEffect, useCallback } from 'react';
import { host } from '../../platform/host';
import { SERVER_START_CAP_MS } from '../../../shared/server-status';

// Local cowork-server lifecycle: the online / busy / busy-kind state, the
// start & stop actions, and the first-paint seed-and-poll that mirrors the
// main process's status until it settles. A no-op poll in the hosted web
// shell, which has no server to control.
//
// `refreshDataRef` holds the app-wide data-load orchestrator (which itself
// writes serverOnline via the returned setter, so it's defined after this
// hook — hence a ref rather than a direct arg). A successful manual start
// re-fetches through it, matching the pre-extraction behavior.
export function useServerControl({ refreshDataRef }) {
  const [serverOnline, setServerOnline] = useState(host.isWeb);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverBusyKind, setServerBusyKind] = useState('starting'); // 'starting' | 'stopping'

  const handleServerStart = useCallback(async () => {
    setServerBusyKind('starting');
    setServerBusy(true);
    try {
      const result = await host.serverStart?.();
      if (result) {
        setServerOnline(!!result.running);
        if (result.running) setTimeout(() => refreshDataRef.current?.(), 400);
      }
    } catch {} finally { setServerBusy(false); }
  }, [refreshDataRef]);

  const handleServerStop = useCallback(async () => {
    setServerBusyKind('stopping');
    setServerBusy(true);
    try {
      const result = await host.serverStop?.();
      if (result) setServerOnline(!!result.running);
    } catch {} finally { setServerBusy(false); }
  }, []);

  // Seed server state from main's truth on first paint so the toggle
  // button reflects reality (running OR starting) even before /health
  // has returned. While main is mid-start, show the spinner; poll
  // every 600 ms until it resolves — OR until we've polled long
  // enough that we'd expect main to have decided one way or the
  // other.
  //
  // The earlier version stopped as soon as `info.starting === false`,
  // which lost the race against main's boot path: the renderer
  // mounts and runs its first tick before main has finished
  // `checkInstallStatus()` + spawned the python (so `pendingStart`
  // is still null and `info.starting === false` even though the
  // boot path is about to start one). The renderer would settle on
  // "offline" and never re-poll, leaving the user looking at a
  // grey status pill while a perfectly healthy server was
  // listening in the background.
  //
  // Fix: keep ticking until either `info.running` flips true OR a
  // hard ceiling elapses. After the ceiling we stop and trust the
  // status pill / sidebar toggle to recover by user action.
  //
  // The ceiling has to outlast main's start budget, or this loop declares
  // the backend offline while main is still legitimately waiting for it —
  // the user sees the failure panel for a start that goes on to succeed.
  // Derived from the shared cap rather than a second hand-picked number so
  // the two cannot drift apart.
  useEffect(() => {
    if (host.isWeb) return; // No server lifecycle to poll in the hosted web shell.
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();
    const POLL_CEILING_MS = SERVER_START_CAP_MS + 60_000;

    // Exactly one timer per tick. An earlier version scheduled inside the
    // starting/not-running branch AND again below it, overwriting `timer` and
    // leaking the first — so the poll rate doubled every tick. A warm start
    // resolved in two ticks and hid it; a slow start would have turned it into
    // thousands of concurrent polls.
    const tick = async () => {
      try {
        const info = await host.serverInfo();
        if (cancelled || !info) return;
        const running = info.running === true;
        const starting = info.starting === true;
        if (typeof info.running === 'boolean') setServerOnline(running);
        if (starting) setServerBusyKind('starting');
        setServerBusy(starting);
        if (running) return; // settled
        // Keep polling while main says it's still starting (main owns the
        // hard cap, so this can't run forever), and otherwise until the
        // ceiling — which covers the window where main is still resolving
        // `checkInstallStatus` before kicking off `startServer`.
        if (starting || Date.now() - startedAt < POLL_CEILING_MS) {
          timer = setTimeout(tick, starting ? 600 : 1000);
        }
      } catch {
        // Polling errors (IPC blip, restart) shouldn't kill the
        // loop — keep trying within the ceiling so a transient
        // hiccup doesn't strand the renderer in offline state.
        if (Date.now() - startedAt < POLL_CEILING_MS) {
          timer = setTimeout(tick, 600);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return {
    serverOnline,
    setServerOnline,
    serverBusy,
    setServerBusy,
    serverBusyKind,
    setServerBusyKind,
    handleServerStart,
    handleServerStop,
  };
}
