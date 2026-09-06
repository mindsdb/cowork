import { useState, useEffect, useCallback } from 'react';
import { host } from '../../platform/host';
import { SERVER_START_CAP_MS } from '../../../shared/server-status';

// Control the local sidecar; hosted web has no lifecycle to poll.
// refreshDataRef is assigned after this hook because the app-wide loader also uses its returned
// state setter.
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

  // Keep polling until running or the ceiling: starting=false can precede main's initial install
  // check and spawn.
  // The ceiling must outlast SERVER_START_CAP_MS so the UI does not report failure during a valid
  // startup.
  useEffect(() => {
    if (host.isWeb) return; // No server lifecycle to poll in the hosted web shell.
    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();
    const POLL_CEILING_MS = SERVER_START_CAP_MS + 60_000;

    // Schedule exactly one timer per tick; overwriting the handle leaves an untracked poll running.
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
// Keep polling during main's bounded startup, or through the pre-spawn ceiling when starting is
// still false.
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
