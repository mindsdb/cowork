/*
 * WorkspaceShell — the app-framed layout for the redesigned artifact workspace.
 *
 * This is NOT a modal. It is the full-height application frame: macOS traffic lights,
 * then a flex row of [icon rail] + [main panel]. The main panel is a rounded surface
 * card holding the top bar, the body (canvas + collapsible right rail), and an optional
 * full-width bottom strip.
 *
 * Pure presentational shell (M0 chassis). All content arrives via slots so the
 * composition agent wires real data in later. Renders standalone with mock slots.
 *
 * Props (all slots are ReactNodes unless noted):
 *   iconRail      — left rail slot. Pass null to omit (the app modal already supplies the
 *                   nav rail); undefined shows a built-in mock for standalone preview.
 *   topBar        — header slot inside the main panel. Typically <TopBar/>. Mock fallback.
 *   children      — the canvas / stage. Fills remaining width (flex:1).
 *   rail          — right rail slot (376px). Hidden when railCollapsed is true.
 *   railCollapsed boolean  — collapse the right rail and show a floating "Story" handle.
 *   onToggleRail  function — invoked by the collapse handle / collapsed-rail button.
 *   bottomStrip   — full-width strip under the body. Omitted if absent.
 */

import React from 'react';

const ICON_RAIL_WIDTH = 56;
const STORY_RAIL_WIDTH = 376;
const TOP_BAR_HEIGHT = 50;

function cssSize(value, fallback) {
  if (value == null) return fallback;
  return typeof value === 'number' ? `${value}px` : value;
}

function TrafficLights() {
  const dot = (bg) => ({ width: 12, height: 12, borderRadius: '50%', background: bg });
  return (
    <div style={{ position: 'absolute', top: 18, left: 18, display: 'flex', gap: 8, zIndex: 50 }}>
      <span style={dot('#ff5f57')} />
      <span style={dot('#febc2e')} />
      <span style={dot('#28c840')} />
    </div>
  );
}

function ChevronLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function MockRail() {
  return (
    <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 12.5 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Story</div>
      chat · versions · reviews
    </div>
  );
}

export function WorkspaceShell({
  iconRail,
  topBar,
  children,
  rail,
  railWidth = STORY_RAIL_WIDTH,
  railCollapsed = false,
  onToggleRail,
  bottomStrip,
} = {}) {
  const showRail = !railCollapsed;
  const storyRailWidth = cssSize(railWidth, `${STORY_RAIL_WIDTH}px`);

  return (
    <div
      className="rd-workspace-shell"
      style={{
        '--rd-icon-rail-width': `${ICON_RAIL_WIDTH}px`,
        '--rd-story-rail-width': storyRailWidth,
        '--rd-topbar-height': `${TOP_BAR_HEIGHT}px`,
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'var(--bg)',
        color: 'var(--ink-2)',
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
      }}
    >
      <div className="rd-workspace-shell__frame" style={{ display: 'flex', height: '100%', padding: 8, gap: 8 }}>
        {/* Icon rail slot. Omitted entirely when explicitly null — the redesign
            runs inside the app modal, which already has the app's sidebar, so a
            second nav rail is redundant. `undefined` still shows the mock for
            standalone component preview. */}
        {iconRail === undefined ? (
          <div
            style={{
              width: 'var(--rd-icon-rail-width, 56px)',
              flexShrink: 0,
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 14,
              boxShadow: 'var(--sh-2, 0 1px 0 rgba(0,0,0,.4),0 6px 18px rgba(0,0,0,.5))',
            }}
          />
        ) : (
          iconRail
        )}

        {/* MAIN PANEL */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            boxShadow: 'var(--sh-2, 0 1px 0 rgba(0,0,0,.4),0 6px 18px rgba(0,0,0,.5))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Top bar slot */}
          {topBar ?? (
            <div
              style={{
                height: 'var(--rd-topbar-height, 50px)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                borderBottom: '1px solid var(--line)',
                color: 'var(--ink)',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Untitled artifact
            </div>
          )}

          {/* BODY: canvas + right rail */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Canvas / stage */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
              {children}
            </div>

            {/* Right rail (collapsible) */}
            {showRail ? (
              <div
                className="rd-workspace-shell__rail"
                style={{
                  width: 'var(--rd-story-rail-width, 376px)',
                  maxWidth: 'min(var(--rd-story-rail-width, 376px), calc(100vw - 88px))',
                  flexShrink: 0,
                  background: rail ? 'transparent' : 'var(--surface)',
                  borderLeft: rail ? 'none' : '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  animation: 'slideIn .3s ease',
                  minHeight: 0,
                }}
              >
                {/* When a custom rail slot is provided it owns its own header/toggle.
                    The mock fallback gets a small header with the collapse control so
                    the toggle is reachable in standalone preview. */}
                {rail ?? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '13px 14px',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Story</span>
                      <div style={{ flex: 1 }} />
                      <button
                        onClick={onToggleRail}
                        title="Collapse"
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--ink-3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                      </button>
                    </div>
                    <MockRail />
                  </>
                )}
              </div>
            ) : (
              // Collapsed: floating handle to reopen the rail.
              <button
                className="rd-no-truncate"
                onClick={onToggleRail}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: 'calc(var(--rd-topbar-height, 50px) + 14px)',
                  zIndex: 30,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  height: 34,
                  padding: '0 13px',
                  borderRadius: 9,
                  border: '1px solid var(--line-2)',
                  background: 'var(--surface)',
                  color: 'var(--ink-2)',
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  boxShadow: '0 8px 20px -8px rgba(0,0,0,.6)',
                  whiteSpace: 'nowrap',
                }}
              >
                <ChevronLeft />
                Story
              </button>
            )}
          </div>

          {/* Optional bottom strip (e.g. version scrubber) */}
          {bottomStrip ? <div style={{ flexShrink: 0 }}>{bottomStrip}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default WorkspaceShell;
