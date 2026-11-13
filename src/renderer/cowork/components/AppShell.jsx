import MobileShell from './MobileShell';

// The content column of the desktop/tablet shell, extracted from App.jsx.
// Below the phone breakpoint it wraps the same content in MobileShell instead.
//
// The titlebar, the sidebar element and the route→view switch stay in App
// because they close over app state: App renders <AppTitlebar/> above and
// <Sidebar/> beside this, passes the route views as children, and hands the
// mobile drawer's handlers in as mobileShellProps.
export default function AppShell({
  isMobile,
  mainBg,
  mobileShellProps,
  children,
}) {
  const mainEl = (
    <main style={{
      flex: 1, minWidth: 0, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      background: mainBg,
      // Content never drags the window (the titlebar does), and Electron
      // swallows events over drag regions, so opt out explicitly in case an
      // ancestor sets one.
      WebkitAppRegion: 'no-drag',
    }}>
      {children}
    </main>
  );

  if (isMobile) {
    return <MobileShell {...mobileShellProps}>{mainEl}</MobileShell>;
  }

  return mainEl;
}
