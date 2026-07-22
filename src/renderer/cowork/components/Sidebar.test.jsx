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

describe('Sidebar — footer theme toggle (design polish PR 3: chrome)', () => {
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('renders the theme toggle in the footer and calls onToggleTheme when clicked', () => {
    hostMock.isWeb = false;
    const onToggleTheme = vi.fn();
    render(
      <Sidebar {...baseProps} serverOnline theme="dark" onToggleTheme={onToggleTheme} />
    );
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    toggle.click();
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('still shows the theme toggle on the web build, which hides Settings', () => {
    hostMock.isWeb = true;
    const onToggleTheme = vi.fn();
    render(
      <Sidebar {...baseProps} theme="light" onToggleTheme={onToggleTheme} />
    );
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('renders the 8-bit skin toggle next to the theme toggle and calls onToggleSkin', () => {
    hostMock.isWeb = false;
    const onToggleSkin = vi.fn();
    render(
      <Sidebar {...baseProps} serverOnline skin="normal" onToggleSkin={onToggleSkin} />
    );
    const toggle = screen.getByRole('button', { name: 'Toggle 8-bit style' });
    expect(toggle.className).not.toContain('is-on');
    toggle.click();
    expect(onToggleSkin).toHaveBeenCalledTimes(1);
  });

  it('lights the skin toggle when a non-default skin is active', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline skin="8bit" />);
    expect(
      screen.getByRole('button', { name: 'Toggle 8-bit style' }).className
    ).toContain('is-on');
  });

  it('hides the theme toggle when showThemeToggle is false', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline showThemeToggle={false} />);
    expect(screen.queryByRole('button', { name: /Switch to (dark|light) theme/ })).toBeNull();
  });

  it('hides the 8-bit toggle when show8bitToggle is false', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline show8bitToggle={false} />);
    expect(screen.queryByRole('button', { name: 'Toggle 8-bit style' })).toBeNull();
  });

  // Flipping this toggle would normally set skin straight to '8bit'/'normal',
  // which would silently discard an active Custom theme recipe (it only
  // applies while skin === 'custom'). Rather than hide the button, the
  // caller (App.jsx) repurposes onToggleSkin to flip just the mono font
  // while Custom is active, and passes is8bitActive to track that font
  // choice instead of `skin` itself.
  it('still shows the 8-bit toggle under the Custom skin, relabeled for the font it actually controls there', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline show8bitToggle skin="custom" />);
    expect(screen.getByRole('button', { name: 'Toggle 8-bit font' })).toBeInTheDocument();
  });

  it('reads is8bitActive (not skin) for the "on" state under the Custom skin', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline show8bitToggle skin="custom" is8bitActive={false} />);
    expect(screen.getByRole('button', { name: 'Toggle 8-bit font' }).className).not.toContain('is-on');
  });

  it('shows a divider before the toggle group when at least one toggle is visible', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    expect(document.querySelector('.anton-sidebar__footer-divider')).not.toBeNull();
  });

  it('hides the divider when both toggles are hidden', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline showThemeToggle={false} show8bitToggle={false} />);
    expect(document.querySelector('.anton-sidebar__footer-divider')).toBeNull();
  });
});

describe('Sidebar — nav title/logo override', () => {
  it('shows the default "MindsHub" wordmark and no logo when unset', () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
    expect(document.querySelector('.anton-sidebar__logo')).toBeNull();
  });

  it('shows a custom navTitle and navLogo when set', () => {
    render(<Sidebar {...baseProps} navTitle="Acme Workspace" navLogo="data:image/png;base64,abc123" />);
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
    expect(screen.queryByText('MindsHub')).toBeNull();
    const img = document.querySelector('.anton-sidebar__logo');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('falls back to "MindsHub" when navTitle is an empty string', () => {
    render(<Sidebar {...baseProps} navTitle="" />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
  });
});
