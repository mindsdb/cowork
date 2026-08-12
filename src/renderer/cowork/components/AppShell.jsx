import MobileShell from './MobileShell';
import Ico from './Icons';
import { Tooltip } from './ui';
import { host } from '../../platform/host';

// The desktop/tablet shell chrome, extracted from App.jsx: the floating
// "reopen sidebar" hamburger and the <main> content column (which owns the
// --titlebar-safe-top inset and opts out of the window drag region). Below
// the phone breakpoint it wraps the same content in MobileShell instead.
//
// The sidebar element and the route→view switch stay in App because they
// close over app state: App renders <Sidebar/> as a sibling before this,
// passes the route views as children, and hands the mobile drawer's
// handlers in as mobileShellProps. On desktop this returns a fragment so
// the hamburger and <main> land as direct children of App's flex frame,
// beside the sidebar.
export default function AppShell({
  isMobile,
  mainBg,
  titlebarSafeTop,
  showFloatingHamburger,
  onOpenSidebar,
  mobileShellProps,
  children,
}) {
  const mainEl = (
    <main style={{
      flex: 1, minWidth: 0, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      background: mainBg,
      // Top inset any view header reads (via var(--titlebar-safe-top)) to
      // clear the traffic lights + floating hamburger when the sidebar isn't
      // docked over that corner. 0 when it is.
      '--titlebar-safe-top': `${titlebarSafeTop}px`,
      // Opt the content column out of the window drag region so clicks reach
      // outside-click handlers — Electron swallows events over drag regions
      // (desktop only; the web build has no drag regions).
      WebkitAppRegion: 'no-drag',
    }}>
      {children}
    </main>
  );

  if (isMobile) {
    return <MobileShell {...mobileShellProps}>{mainEl}</MobileShell>;
  }

  return (
    <>
      {/* Floating hamburger — reopens a collapsed sidebar (chat route,
          desktop only). Absolute over the window frame; DOM order doesn't
          matter since it's positioned. */}
      <Tooltip content="Open sidebar">
        <button
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="icon-btn"
          style={{
            position: 'absolute',
            // Electron: left 97 clears the macOS traffic lights (they end ~x:80).
            // Web has none, so 18 sits flush with the edge.
            top: 18, left: host.isWeb ? 18 : 97,
            zIndex: 10,
            WebkitAppRegion: 'no-drag',
            opacity: showFloatingHamburger ? 1 : 0,
            transform: showFloatingHamburger ? 'translateX(0)' : 'translateX(-8px)',
            pointerEvents: showFloatingHamburger ? 'auto' : 'none',
            transition:
              'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1) 120ms, ' +
              'transform 360ms cubic-bezier(0.32, 0.72, 0, 1) 80ms',
          }}
        >
          {Ico.sidebarExpandRight(15)}
        </button>
      </Tooltip>
      {mainEl}
    </>
  );
}
