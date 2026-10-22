import { useState, useEffect, useCallback, useRef } from 'react';
import { host } from '../../platform/host';
import { SERVER_START_CAP_MS } from '../../../shared/server-status';

// How often the running app checks that the backend is still up.
export const SERVER_WATCH_MS = 5_000;

// Local cowork-server lifecycle: the online / busy / busy-kind state, the
// start & stop actions, and the first-paint seed-and-poll that mirrors the
// main process's status until it settles. A no-op poll in the hosted web
// shell, which has no server to control.
//
// `refreshDataRef` holds the app-wide data-load orchestrator (which itself
// writes serverOnline via the returned setter, so it's defined after this
// hook — hence a ref rather than a direct arg). A successful manual start
// re-fetches through it, matching the pre-extraction behavior, and so does a
// backend main brought back on its own.
export function useServerControl({ refreshDataRef }) {
  const [serverOnline, setServerOnline] = useState(host.isWeb);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverBusyKind, setServerBusyKind] = useState('starting'); // 'starting' | 'stopping'
  // A manual start or stop owns the spinner while it runs; the watcher below
  // stays out of its way.
  const manualOp = useRef(false);
  // The backend has been seen serving. Until then a "starting" backend is the
  // first boot, which the seed-and-poll below follows, not a restart.
  const seenUp = useRef(false);
  // Main's start generation for the backend the screen was loaded from. Null
  // while the screen shows the backend offline, since coming back online
  // reloads the screen (App re-fetches on that flip); a backend replaced while
  // the screen still showed it online is the watcher's to reload.
  const shownGeneration = useRef(null);
  useEffect(() => {
    if (!serverOnline) shownGeneration.current = null;
  }, [serverOnline]);

  const handleServerStart = useCallback(async () => {
    manualOp.current = true;
    setServerBusyKind('starting');
    setServerBusy(true);
    try {
      const result = await host.serverStart?.();
      if (result) {
        setServerOnline(!!result.running);
        if (result.running) setTimeout(() => refreshDataRef.current?.(), 400);
      }
    } catch {} finally {
      manualOp.current = false;
      setServerBusy(false);
    }
  }, [refreshDataRef]);

  const handleServerStop = useCallback(async () => {
    manualOp.current = true;
    setServerBusyKind('stopping');
    setServerBusy(true);
    try {
      const result = await host.serverStop?.();
      if (result) setServerOnline(!!result.running);
    } catch {} finally {
      manualOp.current = false;
      setServerBusy(false);
    }
  }, []);

  // The status pill's one button. Intent comes from main's actual state, not
  // the screen's: "running OR mid-start" counts as up, so a click during boot
  // stops the in-flight start instead of spawning a second python. It goes
  // through the handlers above so the watcher below keeps out of it.
  const handleServerToggle = useCallback(async () => {
    if (serverBusy) return;
    let isUp = serverOnline;
    try {
      const info = await host.serverInfo();
      if (info && typeof info.running === 'boolean') isUp = info.running || info.starting === true;
    } catch {}
    await (isUp ? handleServerStop() : handleServerStart());
  }, [serverBusy, serverOnline, handleServerStart, handleServerStop]);

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
        if (running) {
          seenUp.current = true;
          shownGeneration.current = info.startGeneration ?? null;
        }
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

  // Once up, keep an eye on it. The backend can die later (a crash, the OS
  // killing it) and main brings it back on its own; without this the app kept
  // showing "online" until the next request failed, and never showed the
  // restart. A cheap IPC read every few seconds, nothing on the network.
  useEffect(() => {
    if (host.isWeb) return undefined;
    let cancelled = false;
    let restarting = false; // the spinner is ours while main brings it back
    // Main's last word on the process. The screen's online state is App's,
    // from /health; the watcher passes on only the process going away or
    // coming back, so one that is alive but not answering doesn't flap it
    // (and set App re-fetching) on every read.
    let mainRunning = null;
    const watch = async () => {
      try {
        const info = await host.serverInfo();
        if (cancelled || manualOp.current || !info || typeof info.running !== 'boolean') return;
        if (info.running !== mainRunning) {
          mainRunning = info.running;
          setServerOnline(info.running);
        }
        if (info.running) {
          seenUp.current = true;
          const generation = info.startGeneration ?? null;
          // A restart that came and went between two reads never shows as
          // starting; only the generation moves.
          const replaced = generation !== null && shownGeneration.current !== null
            && generation !== shownGeneration.current;
          shownGeneration.current = generation;
          if (restarting) {
            // Back online: App re-fetches the screen as it comes online.
            restarting = false;
            setServerBusy(false);
          } else if (replaced) {
            // The screen never saw it go: what is on it was loaded from the
            // process that died.
            refreshDataRef.current?.();
          }
        } else if (info.starting && seenUp.current) {
          restarting = true;
          setServerBusyKind('starting');
          setServerBusy(true);
        } else if (restarting) {
          restarting = false; // main gave up
          setServerBusy(false);
        }
      } catch { /* an IPC blip; the next tick tries again */ }
    };
    const timer = setInterval(watch, SERVER_WATCH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshDataRef]);

  return {
    serverOnline,
    setServerOnline,
    serverBusy,
    setServerBusy,
    serverBusyKind,
    setServerBusyKind,
    handleServerStart,
    handleServerStop,
    handleServerToggle,
  };
}
