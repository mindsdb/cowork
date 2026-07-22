import { useEffect, useMemo, useState } from 'react';
// Namespace import on purpose: the browser host methods land with the
// main-process workstream (host.ts additions). Named/destructured imports
// of not-yet-existing exports would fail the renderer build; property
// access on the namespace simply yields undefined, which every call site
// here guards against (web mode keeps them all no-ops anyway).
import * as host from '../../../platform/host';

export const EMPTY_BROWSER_STATE = { tabs: [], activeTabId: null, viewVisible: false };

// Last known model, kept at module scope so a route round-trip re-seeds
// synchronously instead of flashing EMPTY (start-page hero) while the
// fresh getState round-trips.
let cachedState = null;

function normalizeState(s) {
  if (!s || typeof s !== 'object') return EMPTY_BROWSER_STATE;
  return {
    tabs: Array.isArray(s.tabs) ? s.tabs : [],
    activeTabId: s.activeTabId ?? null,
    viewVisible: !!s.viewVisible,
  };
}

// Live mirror of the main-process browser model. getState once on mount,
// then every state-changed push re-renders from the full snapshot.
// `ready` is false only on a cold first mount (no cache) until the first
// getState resolves — the view renders a neutral blank in that window
// rather than the start-page hero.
export function useBrowserState() {
  const [state, setState] = useState(cachedState || EMPTY_BROWSER_STATE);
  const [ready, setReady] = useState(
    cachedState != null || !host.isElectron || typeof host.browserGetState !== 'function'
  );

  useEffect(() => {
    if (!host.isElectron || typeof host.browserGetState !== 'function') return undefined;
    let alive = true;
    const apply = (s) => {
      if (!alive) return;
      const n = normalizeState(s);
      cachedState = n;
      setState(n);
    };
    host.browserGetState()
      .then((s) => { apply(s); if (alive) setReady(true); })
      // A failed getState must not blank the view forever — fall back to
      // the EMPTY model and let the route behave as "no tabs".
      .catch(() => { if (alive) setReady(true); });
    const unsub = typeof host.onBrowserStateChanged === 'function'
      ? host.onBrowserStateChanged(apply)
      : undefined;
    return () => {
      alive = false;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) || null,
    [state],
  );
  return { state, activeTab, ready };
}
