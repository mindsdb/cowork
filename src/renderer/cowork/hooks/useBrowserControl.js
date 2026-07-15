import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from '../../platform/host';

// Single source of truth for Browser Control bridge state in the renderer.
// Reads the current status on mount, then subscribes to `browser:state` pushes
// so awaiting-approval -> connected -> lost transitions arrive from the main
// process rather than being guessed optimistically. Everything routes through
// the host.ts facade (never the native bridge global directly), per the
// check:cowork-purity gate.
export function useBrowserControl() {
  const [state, setState] = useState('disconnected');
  const [domain, setDomain] = useState(undefined);
  const [tabTitle, setTabTitle] = useState(undefined);
  const [available, setAvailable] = useState(false);
  const mountedRef = useRef(true);

  const applyStatus = useCallback((status) => {
    if (!mountedRef.current || !status) return;
    if (status.state) setState(status.state);
    setDomain(status.domain);
    setTabTitle(status.tabTitle);
    // `available` = "there is a live approved tab", i.e. the bridge is
    // connected. Derived from state (not the transport-level `status.available`
    // feature flag) so mount and the live push below compute it IDENTICALLY —
    // otherwise a fresh mount could report `available:true` (feature present)
    // while the push reports `available` only when connected, and the two would
    // silently disagree.
    setAvailable(status.state === 'connected');
  }, []);

  const refresh = useCallback(async () => {
    const status = await host.browserControlStatus();
    applyStatus(status);
    return status;
  }, [applyStatus]);

  useEffect(() => {
    mountedRef.current = true;
    // Initial read.
    refresh();
    // Live pushes. host.onBrowserControlState returns a no-op unsub on web.
    const unsubscribe = host.onBrowserControlState((payload) => {
      if (!mountedRef.current || !payload) return;
      if (payload.state) setState(payload.state);
      setDomain(payload.domain);
      setTabTitle(payload.tabTitle);
      // available tracks the connected state.
      setAvailable(payload.state === 'connected');
    });
    return () => {
      mountedRef.current = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [refresh]);

  const listTabs = useCallback(() => host.browserControlListTabs(), []);

  // Approve a single tab: the main bridge splits this into attach
  // (-> awaiting-approval) then approve (-> connected). The renderer exposes it
  // as one gesture (the picker's "Approve this tab" button). The resulting
  // awaiting-approval -> connected transitions still arrive via state pushes, so
  // this is not optimistic — we only forward the confirm.
  const attach = useCallback(async (targetId) => {
    const attached = await host.browserControlAttach(targetId);
    if (attached && attached.ok === false) return attached;
    return host.browserControlApprove();
  }, []);

  const cancelAttach = useCallback(() => host.browserControlCancelAttach(), []);

  const revoke = useCallback(async () => {
    const result = await host.browserControlRevoke();
    await refresh();
    return result;
  }, [refresh]);

  const takeOver = useCallback(async () => {
    const result = await host.browserControlTakeOver();
    await refresh();
    return result;
  }, [refresh]);

  return {
    state,
    domain,
    tabTitle,
    available,
    listTabs,
    attach,
    cancelAttach,
    revoke,
    takeOver,
    refresh,
  };
}

export default useBrowserControl;
