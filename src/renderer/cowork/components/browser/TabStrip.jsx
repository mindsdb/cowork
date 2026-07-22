import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Spinner, Tooltip } from '../ui';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../../platform/host';

// Platform-aware modifier symbol for keyboard hints (Sidebar's 2-liner).
const IS_MAC = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function tabLabel(tab) {
  if (tab.title) return tab.title;
  if (tab.url) return hostOf(tab.url) || tab.url;
  return 'New Tab';
}

function Favicon({ tab }) {
  if (tab.isLoading) {
    return <Spinner intervalMs={90} style={{ fontSize: 12, width: 14, color: 'var(--ink-4)' }} />;
  }
  if (tab.favicon) {
    return (
      <img
        src={tab.favicon}
        alt=""
        aria-hidden="true"
        style={{ width: 14, height: 14, borderRadius: 3, flex: '0 0 auto' }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  // Blank start-page tab reads as "home"; loaded tabs without a favicon
  // fall back to the neutral globe.
  return (
    <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--ink-4)' }}>
      {tab.url ? Ico.globe(14) : Ico.home(14)}
    </span>
  );
}

// Chrome-like compact tab strip. Tabs come straight from main's model;
// every interaction is one IPC call — no local tab state here.
export default function TabStrip({
  tabs,
  activeTabId,
  dockOpen,
  onActivate,
  onClose,
  onNewTab,
  onToggleDock,
}) {
  const stripRef = useRef(null);
  // Tab elements by id — Left/Right arrow-key navigation moves focus
  // between tabs without activating (Enter/Space activates, like Chrome).
  const tabRefs = useRef(new Map());
  // Edge fade (CSS mask) only once the tabs actually overflow.
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;
    const check = () => setScrollable(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);

  return (
    <div style={{
      height: 36, flex: '0 0 auto',
      display: 'flex', alignItems: 'flex-end',
      padding: '0 8px', gap: 2,
    }}>
      <div
        ref={stripRef}
        className={`browser-tabstrip-scroll${scrollable ? ' is-scrollable' : ''}`}
        role="tablist"
        aria-label="Browser tabs"
        onWheel={(e) => {
          // Vertical wheel over the strip scrolls the tabs horizontally
          // (the strip itself never scrolls vertically).
          const el = e.currentTarget;
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
        }}
        style={{
          flex: '0 1 auto', minWidth: 0,
          display: 'flex', alignItems: 'flex-end', gap: 2,
          overflowX: 'auto', overflowY: 'hidden',
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const label = tabLabel(tab);
          return (
            <div
              key={tab.id}
              ref={(el) => { if (el) tabRefs.current.set(tab.id, el); else tabRefs.current.delete(tab.id); }}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              className={`browser-tab${active ? ' is-active' : ''}`}
              style={{ flex: tabs.length > 1 ? '0 1 200px' : '0 1 240px', minWidth: 72 }}
              title={tab.url ? `${label} — ${tab.url}` : label}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(tab.id); }
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const idx = tabs.findIndex((t) => t.id === tab.id);
                  const next = tabs[idx + (e.key === 'ArrowLeft' ? -1 : 1)];
                  if (next) tabRefs.current.get(next.id)?.focus();
                }
              }}
              onAuxClick={(e) => {
                // Middle-click closes, like Chrome.
                if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
              }}
            >
              <Favicon tab={tab} />
              <span className="browser-tab__title">{label}</span>
              {tab.isAgentControlled && (
                <span
                  aria-label="Agent is driving this tab"
                  title="Agent is driving this tab"
                  style={{
                    flex: '0 0 auto', width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--accent)',
                  }}
                />
              )}
              <button
                type="button"
                // Keyboard-reachable on the active tab (where the close is
                // always visible); hover-only tabs stay pointer territory.
                tabIndex={active ? 0 : -1}
                aria-label={`Close ${label}`}
                className="browser-tab__close"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
              >
                {Ico.close(10)}
              </button>
            </div>
          );
        })}
        <Tooltip content={`New tab  ${MOD_LABEL}T`} delay={250}>
          <button
            type="button"
            className="icon-btn"
            aria-label="New tab"
            style={{ marginBottom: 4 }}
            onClick={onNewTab}
          >
            {Ico.plus(14)}
          </button>
        </Tooltip>
      </div>

      <span style={{ flex: 1 }} />

      <Tooltip content={dockOpen ? `Hide Browser Agent  ${MOD_LABEL}J` : `Browser Agent  ${MOD_LABEL}J`} side="left" delay={250}>
        <button
          type="button"
          className={`icon-btn${dockOpen ? ' active' : ''}`}
          aria-label="Toggle Browser Agent"
          aria-pressed={dockOpen}
          style={{ marginBottom: 4 }}
          onClick={onToggleDock}
        >
          {Ico.panelRight(15)}
        </button>
      </Tooltip>
    </div>
  );
}
