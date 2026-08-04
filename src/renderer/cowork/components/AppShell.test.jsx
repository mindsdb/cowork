import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// host.isWeb only shifts the hamburger's left offset; default to Electron.
const hostMock = vi.hoisted(() => ({ isWeb: false, isMac: () => false }));
vi.mock('../../platform/host', () => ({ host: hostMock }));
// Isolate AppShell from MobileShell's internals — a passthrough that just
// records it wrapped the content.
vi.mock('./MobileShell', () => ({
  default: ({ children }) => <div data-testid="mobile-shell">{children}</div>,
}));

import AppShell from './AppShell';

const baseProps = {
  mainBg: 'transparent',
  titlebarSafeTop: 0,
  showFloatingHamburger: false,
  onOpenSidebar: () => {},
  mobileShellProps: {},
};

describe('AppShell', () => {
  it('renders children in <main> with the hamburger on desktop, and no MobileShell', () => {
    render(<AppShell {...baseProps} isMobile={false}><div>route-view</div></AppShell>);
    expect(screen.getByText('route-view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).toBeNull();
  });

  it('wraps the same content in MobileShell below the phone breakpoint', () => {
    render(<AppShell {...baseProps} isMobile={true}><div>route-view</div></AppShell>);
    const shell = screen.getByTestId('mobile-shell');
    expect(shell).toHaveTextContent('route-view');
    // The desktop hamburger is not part of the mobile branch.
    expect(screen.queryByRole('button', { name: 'Open sidebar' })).toBeNull();
  });

  it('exposes titlebarSafeTop as --titlebar-safe-top on <main>', () => {
    render(<AppShell {...baseProps} isMobile={false} titlebarSafeTop={52}><div>x</div></AppShell>);
    expect(screen.getByRole('main').style.getPropertyValue('--titlebar-safe-top')).toBe('52px');
  });

  it('calls onOpenSidebar when the hamburger is clicked', () => {
    const onOpenSidebar = vi.fn();
    render(
      <AppShell {...baseProps} isMobile={false} showFloatingHamburger onOpenSidebar={onOpenSidebar}>
        <div>x</div>
      </AppShell>,
    );
    screen.getByRole('button', { name: 'Open sidebar' }).click();
    expect(onOpenSidebar).toHaveBeenCalledTimes(1);
  });
});
