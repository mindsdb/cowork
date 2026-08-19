import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Mutable host mock so each test can flip isWeb. getAccessToken resolves the
// token behind the footer user menu — null (signed out) unless a test sets
// one; openExternal/logout are consumed by the UserMenu the footer renders
// when signed in.
const hostMock = vi.hoisted(() => ({ isWeb: true, isMac: () => false, logout: async () => {} }));
const getAccessTokenMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../../platform/host', () => ({
  host: hostMock,
  getAccessToken: getAccessTokenMock,
  openExternal: vi.fn(async () => {}),
}));

import Sidebar from './Sidebar';

const baseProps = { tasks: [], onNavigate: () => {} };

// Minimal decodable JWT for the signed-in footer tests.
const jwt = (payload) =>
  `header.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.sig`;

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

  it('opens general settings (not forced to a specific section)', () => {
    // Was: forced straight to 'settings:agent'. The Agent section (where
    // reasoning effort lives) is still one click away via Settings' own
    // nav — this button is just a general entry point now, not an
    // Agent-specific shortcut.
    const onNavigate = vi.fn();
    hostMock.isWeb = true;
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />);
    screen.getByRole('button', { name: 'Settings' }).click();
    expect(onNavigate).toHaveBeenCalledWith('settings');
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

  it('shows the authoritative auto-update action and hides the manual fallback', () => {
    const onShellAutoUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        shellUpdate={{ version: '2.0.0' }}
        shellAutoUpdate={{
          phase: 'ready-to-install',
          mode: 'auto',
          channel: 'prod',
          currentVersion: '2.0.0',
          targetVersion: '2.1.0',
        }}
        onShellAutoUpdateAction={onShellAutoUpdateAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /App update ready/ }));
    expect(onShellAutoUpdateAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /New version available/ })).toBeNull();
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

describe('Sidebar — footer user menu when signed in (ENG-1408)', () => {
  // Parity with the web console: a signed-in user gets the account row
  // (avatar + name · org + menu) instead of the bare Settings row. Settings
  // moves inside the menu, but the quick theme + 8-bit toggles stay in the
  // footer (ENG-1545) — restored from the menu-only placement ENG-1408 used.
  beforeEach(() => {
    getAccessTokenMock.mockResolvedValue(
      jwt({ name: 'Hazem Ahmed', email: 'hazem@example.com', active_organization: { displayName: 'MindsDB' } })
    );
  });

  afterEach(() => {
    getAccessTokenMock.mockResolvedValue(null);
  });

  it('replaces the Settings row with the account row', async () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    const row = await screen.findByRole('button', { name: /Hazem Ahmed/ });
    expect(row.textContent).toContain('MindsDB');
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('keeps the plain Settings row when signed out', async () => {
    getAccessTokenMock.mockResolvedValue(null);
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline />);
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the backend status pill instead of the account row when the server is down', async () => {
    hostMock.isWeb = false;
    render(<Sidebar {...baseProps} serverOnline={false} />);
    expect(await screen.findByRole('button', { name: /Backend status/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hazem Ahmed/ })).toBeNull();
  });
});
