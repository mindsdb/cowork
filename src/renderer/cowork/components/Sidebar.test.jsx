import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mutable host mock so each test can flip isWeb. Sidebar reads host.isWeb at
// render time to decide whether to show the web-only Channels entry (ENG-720:
// Channels lives under Settings, which the web shell hides, so the hosted
// build needs a standalone left-nav entry; the desktop app reaches it via
// Settings and must NOT get a duplicate).
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false }));
vi.mock('../../platform/host', () => ({ host: hostMock }));

import Sidebar from './Sidebar';

const baseProps = { tasks: [], onNavigate: () => {} };

describe('Sidebar — Channels entry (ENG-720)', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('shows a Channels nav item in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Channels' })).toBeInTheDocument();
  });

  it('hides the Channels nav item in the Electron build (reachable via Settings there)', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Channels' })).toBeNull();
  });

  it('navigates to the channels route when the web nav item is clicked', () => {
    const onNavigate = vi.fn();
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Channels' }).click();
    expect(onNavigate).toHaveBeenCalledWith('channels');
  });
});

describe('Sidebar — nav title override', () => {
  it('shows the default "MindsHub" wordmark when no navTitle is set', () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
  });

  it('shows the custom navTitle in place of "MindsHub" when set', () => {
    render(<Sidebar {...baseProps} navTitle="Acme Workspace" />);
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
    expect(screen.queryByText('MindsHub')).toBeNull();
  });

  it('falls back to "MindsHub" when navTitle is an empty string', () => {
    render(<Sidebar {...baseProps} navTitle="" />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
  });
});

describe('Sidebar — logo override', () => {
  it('renders no logo image by default', () => {
    render(<Sidebar {...baseProps} />);
    expect(document.querySelector('.anton-sidebar__logo')).toBeNull();
  });

  it('renders the logo image when navLogo is set', () => {
    render(<Sidebar {...baseProps} navLogo="data:image/png;base64,abc123" />);
    const img = document.querySelector('.anton-sidebar__logo');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });
});
