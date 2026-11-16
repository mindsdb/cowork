import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Isolate AppShell from MobileShell's internals — a passthrough that just
// records it wrapped the content.
vi.mock('./MobileShell', () => ({
  default: ({ children }) => <div data-testid="mobile-shell">{children}</div>,
}));

import AppShell from './AppShell';

const baseProps = {
  mainBg: 'transparent',
  mobileShellProps: {},
};

describe('AppShell', () => {
  it('renders children in <main> on desktop, with no MobileShell', () => {
    render(<AppShell {...baseProps} isMobile={false}><div>route-view</div></AppShell>);
    expect(screen.getByRole('main')).toHaveTextContent('route-view');
    expect(screen.queryByTestId('mobile-shell')).toBeNull();
  });

  it('wraps the same content in MobileShell below the phone breakpoint', () => {
    render(<AppShell {...baseProps} isMobile={true}><div>route-view</div></AppShell>);
    expect(screen.getByTestId('mobile-shell')).toHaveTextContent('route-view');
  });

  it('no longer floats an open-sidebar button over the content', () => {
    render(<AppShell {...baseProps} isMobile={false}><div>x</div></AppShell>);
    expect(screen.queryByRole('button', { name: 'Open sidebar' })).toBeNull();
  });
});
