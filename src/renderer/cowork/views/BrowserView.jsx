import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import { Button } from '../components/ui';
import { useBreakpoint } from '../hooks/useBreakpoint';
import TabStrip from '../components/browser/TabStrip';
import NavRow from '../components/browser/NavRow';
import FindBar from '../components/browser/FindBar';
import StartPage from '../components/browser/StartPage';
import AgentDock from '../components/browser/AgentDock';
import { useBrowserState } from '../components/browser/useBrowserState';
import { useNativeBounds } from '../components/browser/useNativeBounds';
import { useNativeOcclusion, OVERLAY_SELECTOR } from '../components/browser/useNativeOcclusion';
import { useBrowserAgent } from '../components/browser/useBrowserAgent';
// Namespace import + `?.()` guards everywhere: the browser bridge methods
// land with the main-process workstream, and every one is a no-op/empty
// fallback in the web shell — this view must render (start page, dock)
// without them and never crash web mode.
import * as host from '../../platform/host';

const DOCK_MIN = 300;
const DOCK_MAX = 480;
const DOCK_DEFAULT = 360;

function loadDockOpen() {
  try { return window.localStorage.getItem('cowork.browser.dock') !== 'closed'; } catch { return true; }
}
function loadDockWidth() {
  try {
    const w = parseInt(window.localStorage.getItem('cowork.browser.dockW'), 10);
    if (Number.isFinite(w)) return Math.max(DOCK_MIN, Math.min(DOCK_MAX, w));
  } catch {}
  return DOCK_DEFAULT;
}

// Strip query/hash — same redaction main uses anywhere a URL is logged or
// shown outside the omnibox.
function redactUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url || '').split('?')[0].split('#')[0];
  }
}

function LoadErrorOverlay({ tab, onRetry }) {
  return (
    <div role="alert" style={{
      position: 'absolute', inset: 0, zIndex: 2,
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 10, padding: 24, textAlign: 'center',
      fontFamily: 'var(--font-body)',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.warning(34)}</span>
      <div className="s-h3">Can't reach this page</div>
      {tab.url && (
        <div className="s-mono" style={{
          fontSize: 12, color: 'var(--ink-4)', maxWidth: '64ch',
          overflowWrap: 'break-word',
        }}>
          {redactUrl(tab.url)}
        </div>
      )}
      {tab.error?.description && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', maxWidth: '52ch', lineHeight: 1.5 }}>
          {tab.error.description}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button variant="primary" size="sm" onClick={onRetry}>Try Again</Button>
      </div>
    </div>
  );
}

// The embedded-browser route. Tabs are native WebContentsViews owned by
// main; this view renders the chrome (tab strip, nav row, progress), a DOM
// start page, the agent dock, and a placeholder div whose on-screen rect is
// mirrored to the native view via IPC.
export default function BrowserView() {
  const { isNarrow } = useBreakpoint();
  const { state, activeTab, ready } = useBrowserState();
  const agent = useBrowserAgent();

  const [dockOpen, setDockOpen] = useState(loadDockOpen);
  const [dockWidth, setDockWidth] = useState(loadDockWidth);
  const [dockResizing, setDockResizing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  useEffect(() => { try { window.localStorage.setItem('cowork.browser.dock', dockOpen ? 'open' : 'closed'); } catch {} }, [dockOpen]);
  useEffect(() => { try { window.localStorage.setItem('cowork.browser.dockW', String(dockWidth)); } catch {} }, [dockWidth]);

  const placeholderRef = useRef(null);
  const omniboxRef = useRef(null);

  const activeTabId = state.activeTabId;
  const closeFind = useCallback(() => {
    setFindOpen(false);
    if (activeTabId) host.browserStopFind?.(activeTabId);
  }, [activeTabId]);
  // Switching tabs closes the bar and clears the highlights — on the tab
  // being LEFT: this effect runs after activeTabId has already changed, so
  // closeFind would send stopFind to the destination tab and leave the old
  // page's matches highlighted (Codex review on #480).
  const prevTabRef = useRef(activeTabId);
  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = activeTabId;
    if (prev !== activeTabId && findOpen) {
      setFindOpen(false);
      if (prev) host.browserStopFind?.(prev);
    }
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Until the first getState resolves (cold mount, no cache) show a
  // neutral blank surface — not the start-page hero, which would flash
  // away the moment the real tab model lands.
  const showStartPage = ready && (!activeTab || !activeTab.url);
  const hasError = !!activeTab?.error;
  const occluded = useNativeOcclusion();
  // The narrow drawer can't paint over the OS-level native view, so while
  // it's open the page detaches (same treatment as modal occlusion).
  const dockOccludes = isNarrow && dockOpen;
  // Same story for the desktop resizer: pointer events over the native
  // view never reach the renderer, so the page detaches mid-drag (see
  // AgentDock startDrag) and re-attaches with the final rect on release.
  const nativeVisible = host.isElectron && ready
    && !showStartPage && !hasError && !occluded && !dockOccludes && !dockResizing && !suggestionsOpen;

  const { sendBounds, readRect } = useNativeBounds(placeholderRef, { enabled: nativeVisible });

  // Attach/detach the native view. Rendered effect order matters: the
  // bounds hook above pushes the fresh rect before we flip visibility.
  useEffect(() => {
    if (!host.isElectron || typeof host.browserSetVisible !== 'function') return;
    if (nativeVisible) host.browserSetVisible(true, readRect() || undefined);
    else host.browserSetVisible(false);
  }, [nativeVisible, readRect]);

  // Route-leave hygiene: detach the native view on unmount. Tabs are NOT
  // closed — the model lives in main and persists across route visits.
  useEffect(() => () => {
    if (host.isElectron && typeof host.browserSetVisible === 'function') {
      try { host.browserSetVisible(false); } catch {}
    }
  }, []);

  // Tab switch swaps which native view main attaches — re-assert the rect
  // so the incoming view lands in the right spot immediately.
  useEffect(() => {
    if (nativeVisible) sendBounds();
  }, [activeTabId, nativeVisible, sendBounds]);

  const newTab = useCallback((url) => {
    host.browserNewTab?.(url ? { url, activate: true } : { activate: true });
  }, []);
  const closeTab = useCallback((tabId) => { host.browserCloseTab?.(tabId); }, []);
  const activateTab = useCallback((tabId) => { host.browserActivateTab?.(tabId); }, []);
  // Raw text goes to main, which normalizes (bare domain → https, otherwise
  // search). With no active tab this becomes the first tab.
  const navigateActive = useCallback((text) => {
    if (activeTab) host.browserNavigate?.(activeTab.id, text);
    else host.browserNewTab?.({ url: text, activate: true });
  }, [activeTab]);

  // Browser-scoped shortcuts, live only while this route is mounted.
  // (App.jsx's global handler owns ⌘B/⌘K/⌘N — no overlap.)
  useEffect(() => {
    const onKey = (e) => {
      // A modal / the search palette owns the keyboard while open.
      try { if (document.querySelector(OVERLAY_SELECTOR)) return; } catch {}
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Tab navigation first (both shift variants): ⌘1-8 = nth tab,
      // ⌘9 = last tab, Ctrl+Tab / Ctrl+Shift+Tab cycle (Chrome).
      if (mod && !e.altKey && key === 'tab') {
        e.preventDefault();
        const tabs = state.tabs;
        if (tabs.length > 1) {
          const i = tabs.findIndex((t) => t.id === activeTabId);
          const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
          if (next) activateTab(next.id);
        }
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && key >= '1' && key <= '9') {
        e.preventDefault();
        const tabs = state.tabs;
        const idx = key === '9' ? tabs.length - 1 : Number(key) - 1;
        if (tabs[idx]) activateTab(tabs[idx].id);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey) {
        if (key === 't') { e.preventDefault(); newTab(); }
        else if (key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
        else if (key === 'r') { e.preventDefault(); if (activeTabId) host.browserReload?.(activeTabId); }
        else if (key === 'l') {
          e.preventDefault();
          // Chrome behavior: ⌘L while the omnibox is already focused
          // re-selects the whole field (focus() alone is a no-op there).
          const el = omniboxRef.current;
          if (el) { el.focus(); el.select(); }
        } else if (key === 'j') { e.preventDefault(); setDockOpen((v) => !v); }
        else if (key === 'f') { e.preventDefault(); setFindOpen(true); }
      } else if (mod && e.shiftKey && !e.altKey && key === 'r') {
        // ⇧⌘R — hard reload. Main normalizes this to a cache-bypassing
        // reload; same bridge call as ⌘R from here.
        e.preventDefault();
        if (activeTabId) host.browserReload?.(activeTabId);
      } else if (mod && e.shiftKey && !e.altKey && key === 't') {
        // ⇧⌘T — reopen the most recently closed tab.
        e.preventDefault();
        host.browserReopenClosedTab?.();
      } else if (e.key === 'Escape' && isNarrow && dockOpen) {
        // Drawer dismiss — but not while the user is editing a field
        // (Esc there means revert/blur, handled by the input itself).
        if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return;
        setDockOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTabId, isNarrow, dockOpen, newTab, closeTab, activateTab, state.tabs]);

  const isLoading = !!activeTab?.isLoading;
  const progress = isLoading
    ? Math.max(activeTab?.loadProgress ?? 0, 0.06)
    : 1;

  // Navigation counter — bumps on the rising edge of isLoading. The bar
  // is keyed by it, so the width reset to ~6% mounts a FRESH element
  // instead of animating backwards from the previous navigation's 100%
  // (the "reverse sweep"). Render-phase adjust is React's documented
  // derived-state pattern; the re-render lands in the same commit.
  const [loadTracker, setLoadTracker] = useState({ loading: false, count: 0 });
  if (isLoading !== loadTracker.loading) {
    setLoadTracker((t) => ({ loading: isLoading, count: isLoading ? t.count + 1 : t.count }));
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, minWidth: 0,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-body)', color: 'var(--ink)',
    }}>
      <TabStrip
        tabs={state.tabs}
        activeTabId={activeTabId}
        dockOpen={dockOpen}
        onActivate={activateTab}
        onClose={closeTab}
        onNewTab={() => newTab()}
        onToggleDock={() => setDockOpen((v) => !v)}
      />
      <NavRow
        tab={activeTab}
        tabs={state.tabs}
        closedCount={state.closedCount ?? 0}
        omniboxRef={omniboxRef}
        onNavigate={navigateActive}
        onNewTab={() => newTab()}
        onCloseTab={() => { if (activeTabId) closeTab(activeTabId); }}
        onActivateTab={activateTab}
        onSuggestionsToggle={setSuggestionsOpen}
      />
      <div
        className="browser-progress"
        role="progressbar"
        aria-label="Page load progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        style={{ flex: '0 0 auto', background: 'var(--surface)' }}
      >
        <div
          key={`${activeTabId || 'none'}:${loadTracker.count}`}
          className="browser-progress__bar"
          style={{
            width: `${Math.round(progress * 100)}%`,
            opacity: isLoading ? 1 : 0,
          }}
        />
      </div>

      <div
        className="browser-dock-grid"
        style={{
          flex: 1, minHeight: 0, minWidth: 0,
          display: 'grid',
          gridTemplateRows: '1fr',
          // minmax(0, 1fr) lets the content column shrink under the dock
          // instead of pushing it off-screen (same trick as ChatView's
          // rail); the 0px closed track + inner overflow clip the panel.
          gridTemplateColumns: !isNarrow && dockOpen
            ? `minmax(0, 1fr) ${dockWidth}px`
            : 'minmax(0, 1fr) 0px',
          // No lag while dragging the resizer — the 380ms slide is for
          // open/close only (the class supplies it when this is undefined).
          transition: dockResizing ? 'none' : undefined,
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        {/* Content column: when the find bar is open it takes a DOM strip
            at the top and the native view's bounds (mirrored from the inner
            div) shrink below it — the Chrome layout with no OS-view fight. */}
        <div style={{
          position: 'relative', minWidth: 0, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface)',
        }}>
          {findOpen && activeTab && <FindBar tabId={activeTabId} onClose={closeFind} />}
          {/* Native view placeholder. MUST stay opaque (--surface): the
              gravity field shows through transparent gaps and the native
              view above it would look broken. Bounds mirror to main. */}
          <div ref={placeholderRef} style={{
            position: 'relative', flex: 1, minWidth: 0, minHeight: 0,
            background: 'var(--surface)',
          }}>
            {showStartPage && <StartPage onNavigate={navigateActive} />}
            {hasError && !showStartPage && (
              <LoadErrorOverlay
                tab={activeTab}
                onRetry={() => activeTab && host.browserReload?.(activeTab.id)}
              />
            )}
          </div>
        </div>
        {!isNarrow && (
          <AgentDock
            open={dockOpen}
            width={dockWidth}
            onResize={setDockWidth}
            onResizingChange={setDockResizing}
            onClose={() => setDockOpen(false)}
            narrow={false}
            agent={agent}
          />
        )}
      </div>

      {isNarrow && (
        <AgentDock
          open={dockOpen}
          width={dockWidth}
          onResize={null}
          onClose={() => setDockOpen(false)}
          narrow
          agent={agent}
        />
      )}
    </div>
  );
}
