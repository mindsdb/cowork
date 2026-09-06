import MobileShell from './MobileShell';
import Ico from './Icons';
import { Tooltip } from './ui';
import { host } from '../../platform/host';

// App owns the sidebar and route state. Desktop returns a fragment so main and the sidebar
// remain siblings in the flex frame; mobile wraps the same children in MobileShell.
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
      // Reserve header space for traffic lights and the hamburger when the sidebar does not cover
      // that corner.
      '--titlebar-safe-top': `${titlebarSafeTop}px`,
      // Exclude content from Electron’s drag region so outside-click handlers receive mouse events.
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
