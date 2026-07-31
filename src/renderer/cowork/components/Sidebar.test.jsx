import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mutable host mock so each test can flip isWeb.
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false }));
vi.mock('../../platform/host', () => ({ host: hostMock }));

import Sidebar from './Sidebar';

const baseProps = { tasks: [], onNavigate: () => {} };

describe('Sidebar — Channels has no standalone entry on either platform (ENG-932)', () => {
  // ENG-720 gave web a standalone Channels row *because* the web shell hid
  // Settings entirely, and Channels lives under Settings. ENG-932 makes
  // Settings reachable on web, so the workaround is removed — shipping both
  // would leave web with two ways in and desktop with one.
  beforeEach(() => {
    hostMock.isWeb = true;
  });

  it('does not render a standalone Channels nav item in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Channels' })).toBeNull();
  });

  it('does not render one in the Electron build either (reachable via Settings)', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Channels' })).toBeNull();
  });
});

describe('Sidebar — Settings is reachable on web (ENG-932)', () => {
  // The web shell hid the whole Settings entry point, which also hid the
  // reasoning-effort control — the only user-side workaround for a turn that
  // burns its entire output budget and returns nothing (ENG-1042). A hosted
  // user hitting that had no recourse at all.
  it('renders a Settings button in the web build', () => {
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens the Agent section, where reasoning effort lives', () => {
    const onNavigate = vi.fn();
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Settings' }).click();
    expect(onNavigate).toHaveBeenCalledWith('settings:agent');
  });

  it('still renders Settings on Electron when the server is healthy', () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('keeps the backend status pill Electron-only when the server is down', () => {
    // The pill reports on a locally-controllable server, which web does not
    // have — but its absence must not take Settings down with it.
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} serverOnline={false} />);
    expect(screen.queryByRole('button', { name: /Backend status/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
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

  it('shows the theme toggle alongside Settings on the web build', () => {
    // Was: "…which hides Settings". Web no longer hides it (ENG-932), so this
    // now pins that the two footer controls coexist rather than that one is
    // absent.
    hostMock.isWeb = true;
    const onToggleTheme = vi.fn();
    render(
      <Sidebar {...baseProps} theme="light" onToggleTheme={onToggleTheme} />
    );
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
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

describe('Sidebar — update banners (ENG-849: shell reinstall supersedes OTA)', () => {
  beforeEach(() => {
    hostMock.isWeb = false;
  });

  it('shows the OTA "Update ready" (restart) banner when only an OTA update is pending', () => {
    render(<Sidebar {...baseProps} serverOnline updateAvailable={{ version: '1.2.3' }} />);
    expect(screen.getByRole('button', { name: /Update ready/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New version available/ })).toBeNull();
  });

  it('shows the shell reinstall notice when only a shell update is pending', () => {
    render(<Sidebar {...baseProps} serverOnline shellUpdate={{ version: '2.0.0' }} />);
    expect(screen.getByRole('button', { name: /New version available/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update ready/ })).toBeNull();
  });

  it('suppresses the OTA banner while a shell reinstall is pending (no double banner)', () => {
    render(
      <Sidebar {...baseProps} serverOnline updateAvailable={{ version: '1.2.3' }} shellUpdate={{ version: '2.0.0' }} />
    );
    expect(screen.queryByRole('button', { name: /Update ready/ })).toBeNull();
    expect(screen.getByRole('button', { name: /New version available/ })).toBeInTheDocument();
  });

  it('surfaces a labelled retry when an apply failed (does not go silent)', () => {
    const onApplyUpdate = vi.fn();
    render(
      <Sidebar {...baseProps} serverOnline updateError={{ version: '1.2.3' }} onApplyUpdate={onApplyUpdate} />
    );
    const retry = screen.getByRole('button', { name: /Update failed/ });
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveTextContent(/Try again/);
    retry.click();
    expect(onApplyUpdate).toHaveBeenCalled();
  });

  it('lets a pending shell reinstall supersede the failed-apply retry too', () => {
    render(
      <Sidebar {...baseProps} serverOnline updateError={{ version: '1.2.3' }} shellUpdate={{ version: '2.0.0' }} />
    );
    expect(screen.queryByRole('button', { name: /Update failed/ })).toBeNull();
    expect(screen.getByRole('button', { name: /New version available/ })).toBeInTheDocument();
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
