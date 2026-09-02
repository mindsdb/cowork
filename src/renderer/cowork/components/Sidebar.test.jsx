import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { ToastProvider } from './ui/Toast';

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
// The footer user menu now reads the organization listing through the main
// process. Stubbed rather than served, because nothing in this file is about
// organizations; the menu and the hook each have their own test file.
vi.mock('../hooks/useMindsOrgs', () => ({
  useMindsOrgs: () => ({
    orgs: [], activeOrg: null, activeOrgId: null, switching: false,
    switchOrg: vi.fn(), refresh: vi.fn(),
  }),
}));

const hubWorkspacesMock = vi.hoisted(() => ({
  useHubWorkspaces: vi.fn(() => ({
    enabled: false,
    reachable: false,
    workspaces: [],
    activeWorkspaceId: null,
    switching: false,
    switchWorkspace: vi.fn(),
    refresh: vi.fn(),
  })),
}));
// Stubbed rather than exercised here: these tests are about the account
// destinations, and the real hook pulls in api.js, which reads host.getApiOrigin
// at module load and this file's host mock does not provide one. The workspace
// group has its own test file.
vi.mock('../hooks/useHubWorkspaces', () => hubWorkspacesMock);

// WorkspaceSelector calls `useToastManager()` unconditionally, before its own
// early return, and Base UI requires a provider for it. The real tree has one
// (App wraps AppCore, and the sidebar is inside it), so wrap here too rather
// than making the component tolerate its absence.
const render = (ui, options) => rtlRender(ui, { wrapper: ToastProvider, ...options });

import Sidebar from './Sidebar';
import { deriveUpdateBanner } from '../../../shared/update-banner';

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

describe('Sidebar — the single update banner (consolidated, shell-first)', () => {
  beforeEach(() => {
    hostMock.isWeb = false;
  });

  // Which-banner-wins is covered in update-banner.test.ts; these assert the
  // sidebar renders one banner and wires its action/dismiss to the callback.
  const bannerFor = (input) => deriveUpdateBanner(input);

  it('renders the OTA "Update ready" (restart) banner and fires apply-ota', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ ota: { phase: 'available', version: '1.2.3' } })}
        onUpdateAction={onUpdateAction}
      />
    );
    const btn = screen.getByRole('button', { name: /Update ready/ });
    expect(screen.queryByRole('button', { name: /New version available/ })).toBeNull();
    fireEvent.click(btn);
    expect(onUpdateAction).toHaveBeenCalledWith('apply-ota');
  });

  it('renders the dismissible manual installer notice and fires download + dismiss', () => {
    const onUpdateAction = vi.fn();
    const onDismissUpdate = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellManual: { version: '2.0.0' } })}
        onUpdateAction={onUpdateAction}
        onDismissUpdate={onDismissUpdate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /New version available/ }));
    expect(onUpdateAction).toHaveBeenCalledWith('download-installer');
    fireEvent.click(screen.getByRole('button', { name: /Dismiss update notice/ }));
    expect(onDismissUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows exactly one banner (shell-first) when OTA and a shell update both pend', () => {
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({
          ota: { phase: 'available', version: '1.2.3' },
          shellAuto: { phase: 'ready-to-install' },
        })}
        onUpdateAction={vi.fn()}
      />
    );
    // The OTA "Update ready" pill never stacks under the shell banner anymore.
    expect(screen.queryByRole('button', { name: /Update ready/ })).toBeNull();
    expect(screen.getByRole('button', { name: /App update ready/ })).toBeInTheDocument();
  });

  it('surfaces a labelled retry when an OTA apply failed (does not go silent)', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ ota: { phase: 'error', version: '1.2.3' } })}
        onUpdateAction={onUpdateAction}
      />
    );
    const retry = screen.getByRole('button', { name: /Update failed/ });
    expect(retry).toHaveTextContent(/Try again/);
    fireEvent.click(retry);
    expect(onUpdateAction).toHaveBeenCalledWith('apply-ota');
  });

  it('renders the shell auto-update ready banner and fires shell-auto', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellAuto: { phase: 'ready-to-install' } })}
        onUpdateAction={onUpdateAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /App update ready/ }));
    expect(onUpdateAction).toHaveBeenCalledWith('shell-auto');
  });

  it('renders an in-flight download as a disabled banner with no action', () => {
    const onUpdateAction = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        serverOnline
        updateBanner={bannerFor({ shellAuto: { phase: 'downloading', progress: { percent: 42 } } })}
        onUpdateAction={onUpdateAction}
      />
    );
    const btn = screen.getByRole('button', { name: /Downloading update/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onUpdateAction).not.toHaveBeenCalled();
  });

  it('renders no banner when nothing is pending', () => {
    render(<Sidebar {...baseProps} serverOnline updateBanner={bannerFor({})} />);
    expect(screen.queryByRole('button', { name: /Update ready|New version available|App update/ })).toBeNull();
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

describe('Sidebar — recents tell loading, empty and failed apart (ENG-2246)', () => {
  // Before this, all three rendered as an unexplained blank list: `tasks`
  // started as `[]` with no status, and a failed fetch was collapsed to `[]`
  // too. A returning user reads an empty sidebar as lost work, not as a wait.
  it('shows skeleton rows, and no empty-state copy, while loading', () => {
    render(<Sidebar {...baseProps} tasksStatus="loading" />);
    expect(screen.getByLabelText('Loading tasks')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    expect(screen.queryByText(/Couldn’t load your tasks/)).toBeNull();
  });

  it('shows the empty state only once the fetch has succeeded', () => {
    render(<Sidebar {...baseProps} tasksStatus="ready" />);
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
  });

  it('shows a distinct failure with a retry, never the empty state', () => {
    const onRetryTasks = vi.fn();
    render(<Sidebar {...baseProps} tasksStatus="failed" onRetryTasks={onRetryTasks} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetryTasks).toHaveBeenCalledTimes(1);
  });

  it('never shows loading or empty copy once tasks exist', () => {
    const tasks = [{ id: 't1', title: 'Real task', messages: [], updatedAt: '2026-09-02T10:00:00Z' }];
    render(<Sidebar {...baseProps} tasks={tasks} tasksStatus="loading" />);
    expect(screen.getByText('Real task')).toBeTruthy();
    expect(screen.queryByLabelText('Loading tasks')).toBeNull();
    expect(screen.queryByText('No tasks yet')).toBeNull();
  });
});
